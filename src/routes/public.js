import express from 'express';
import multer from 'multer';
import { saveAudio, savePhoto } from '../submissions.js';
import { db, refreshCommentCount } from '../db.js';
import { config } from '../config.js';
import { rankedArticles, getPublishedBySlug, celebrityIndex, articlesForTag, tagLabel } from '../articles.js';
import { homePage, articlePage, tagPage, notFoundPage, commentItem, sendRumorPage, categoryPage } from '../views/public.js';
import { bySlug, articlesIn, trendingTop } from '../categories.js';
import { send } from '../views/layout.js';
import { signToken, readToken, visitorId, rateLimit, sameOrigin, BOT_UA } from '../security.js';
import { list, slugify } from '../html.js';

export const router = express.Router();
const PER_PAGE = 12;

const shortCache = (res) => res.set('Cache-Control', 'public, max-age=0, must-revalidate');

router.get('/', (req, res) => {
  const ranked = rankedArticles();
  const pageCount = Math.max(1, Math.ceil(ranked.latest.length / PER_PAGE));
  const page = Math.min(pageCount, Math.max(1, parseInt(req.query.page, 10) || 1));
  // Page 1 shows the hero/trending block, so skip whatever's already above the fold there.
  const latestPage = ranked.latest.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  shortCache(res);
  send(res, homePage(res, { ranked, celebs: celebrityIndex(ranked.all), page, pageCount, latestPage }));
});

router.get('/category/:slug', (req, res, next) => {
  const cat = bySlug(req.params.slug);
  if (!cat) return next();
  const ranked = rankedArticles();
  shortCache(res);
  send(res, categoryPage(res, { cat, articles: articlesIn(cat.slug, ranked), ranked }));
});

router.get('/tag/:slug', (req, res, next) => {
  const slug = slugify(req.params.slug);
  const ranked = rankedArticles();
  const articles = articlesForTag(ranked.trending, slug);
  if (!articles.length) return next();
  const label = tagLabel(articles, slug);
  const isCeleb = articles.some((a) => list(a.celebrities).some((c) => slugify(c) === slug));
  shortCache(res);
  send(res, tagPage(res, { label, slug, articles, isCeleb }));
});

function loadComments(articleId) {
  return db.prepare(`SELECT id, name, body, created_at, visitor = 'sample' AS sample FROM comments WHERE article_id = ? AND status = 'visible'
    ORDER BY created_at DESC LIMIT 200`).all(articleId);
}

function renderArticle(req, res, a, extra = {}, status = 200) {
  const ranked = rankedArticles();
  const celebs = new Set(list(a.celebrities).map(slugify));
  const others = ranked.trending.filter((x) => x.id !== a.id);
  // Related: same celebrity or neighbourhood first, then the hottest stories.
  const related = [
    ...others.filter((x) => list(x.celebrities).some((c) => celebs.has(slugify(c))) || (a.neighbourhood && x.neighbourhood === a.neighbourhood)),
    ...others,
  ].filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i).slice(0, 3);
  res.set('Cache-Control', 'private, no-cache');
  send(res, articlePage(res, {
    a, comments: loadComments(a.id), related,
    viewToken: signToken('view', a.id), commentToken: signToken('comment', a.id),
    trendingIds: trendingTop(ranked).map((x) => x.id), ...extra,
  }), status);
}

router.get('/rumor/:slug.md', (req, res, next) => {
  const a = getPublishedBySlug(req.params.slug);
  if (!a) return next();
  res.type('text/markdown; charset=utf-8').send(
    `# ${a.title}\n\n> ${a.excerpt}\n\n- Who: ${a.celebrities}\n- Where: ${a.location_name}, ${a.location_address} (${a.neighbourhood}, Toronto)\n- Published: ${a.published_at}\n- Status: Unverified first-hand celebrity sighting\n- Source: ${config.siteUrl}/rumor/${a.slug}\n\n${a.body.replace(/!\[[^\]]*\]\(image:\d+[^)]*\)\n*/g, '')}\n`);
});

router.get('/rumor/:slug', (req, res, next) => {
  const a = getPublishedBySlug(req.params.slug);
  if (!a) return next();
  const notice = req.query.commented === 'pending'
    ? 'Thanks! Your comment is waiting for review.'
    : req.query.commented ? 'Thanks, your comment is live.' : '';
  renderArticle(req, res, a, { notice });
});

// ---------- Comments ----------
const commentLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 6, message: 'You’re commenting a lot. Take a breath and try again in a few minutes.' });

router.post('/rumor/:slug/comments', sameOrigin, commentLimiter, (req, res, next) => {
  const a = getPublishedBySlug(req.params.slug);
  if (!a) return next();
  const wantsJson = req.get('accept')?.includes('application/json');
  const name = String(req.body.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const body = String(req.body.body || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2000);
  const tok = readToken('comment', req.body.token);

  const fail = (msg, status = 400) => (wantsJson
    ? res.status(status).json({ error: msg })
    : renderArticle(req, res, a, { notice: msg, form: { name, body } }, status));

  if (req.body.website) return wantsJson ? res.json({ ok: true, pending: true }) : res.redirect(303, `/rumor/${a.slug}?commented=pending#comments`);
  if (!tok || tok.id !== a.id || tok.ageMs > 1000 * 60 * 60 * 24) return fail('Your session expired. Please reload the page and try again.');
  if (tok.ageMs < 3000) return fail('That was fast! Please take a moment and try again.');
  if (name.length < 1) return fail('Please add a name or nickname.');
  if (body.length < 2) return fail('Please write a comment.');

  const hasLink = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|ca|ru|xyz)\b)/i.test(body);
  const status = hasLink ? 'pending' : 'visible';
  const info = db.prepare('INSERT INTO comments (article_id, name, body, status, visitor) VALUES (?,?,?,?,?)')
    .run(a.id, name, body, status, visitorId(req));
  refreshCommentCount(a.id);

  if (wantsJson) {
    const c = db.prepare('SELECT id, name, body, created_at FROM comments WHERE id = ?').get(info.lastInsertRowid);
    return res.json({ ok: true, pending: hasLink, html: hasLink ? '' : String(commentItem(c)),
      count: db.prepare('SELECT comments_count FROM articles WHERE id = ?').get(a.id).comments_count });
  }
  res.redirect(303, `/rumor/${a.slug}?commented=${hasLink ? 'pending' : '1'}#comments`);
});

// ---------- Qualified views (10+ seconds of visible time) ----------
const viewLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

router.post('/api/views', express.text({ type: '*/*', limit: '1kb' }), sameOrigin, viewLimiter, (req, res) => {
  res.status(204);
  const ua = req.get('user-agent') || '';
  if (BOT_UA.test(ua)) return res.end();
  const tok = readToken('view', typeof req.body === 'string' ? req.body.trim() : '');
  // The token was minted when the page was served: require ≥10s since then (can't be faked client-side).
  if (!tok || tok.ageMs < config.viewThresholdSeconds * 1000 - 500 || tok.ageMs > 1000 * 60 * 60 * 6) return res.end();
  const day = new Date().toISOString().slice(0, 10);
  const r = db.prepare('INSERT OR IGNORE INTO view_events (article_id, visitor, day) SELECT id, ?, ? FROM articles WHERE id = ? AND status = \'published\'')
    .run(visitorId(req), day, tok.id);
  if (r.changes) db.prepare('UPDATE articles SET views = views + 1 WHERE id = ?').run(tok.id);
  res.end();
});

// ---------- Send us a rumor ----------
const tipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 2, fields: 20, fieldSize: 20 * 1024 },
});
const tipLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 8, message: 'You’ve sent a lot of tips this hour. Please try again later.' });

router.get('/send-a-rumor', (req, res) => {
  shortCache(res);
  send(res, sendRumorPage(res, { token: signToken('tip', 0), done: req.query.sent === '1' }));
});

router.post('/send-a-rumor', sameOrigin, tipLimiter, (req, res, next) => tipUpload.fields([{ name: 'audio', maxCount: 1 }, { name: 'photo', maxCount: 1 }])(req, res, (err) => {
  if (err) return fail(req, res, err.code === 'LIMIT_FILE_SIZE' ? 'That file is too big. Files can be up to 15 MB.' : 'Upload failed. Please try again.');
  next();
}), async (req, res) => {
  const b = req.body || {};
  const t = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
  const form = {
    name: t(b.name, 60).replace(/\s+/g, ' '), email: t(b.email, 120), celebrity: t(b.celebrity, 120),
    location_name: t(b.location_name, 120), location_address: t(b.location_address, 200),
    seen_when: t(b.seen_when, 80), story: t(b.story, 5000), consent: !!b.consent,
  };
  const audio = req.files?.audio?.[0];
  const photo = req.files?.photo?.[0];
  if (b.website) return done(req, res); // honeypot: pretend success
  const tok = readToken('tip', b.token);
  if (!tok || tok.ageMs > 1000 * 60 * 60 * 12) return fail(req, res, 'This form expired. Please reload the page and try again.', form);
  if (tok.ageMs < 4000) return fail(req, res, 'That was quick! Please take a moment and try again.', form);
  if (!form.celebrity) return fail(req, res, 'Please tell us who you saw.', form);
  if (!form.location_name) return fail(req, res, 'Please tell us where you saw them.', form);
  if (!form.story && !audio) return fail(req, res, 'Please write what happened or record yourself telling it.', form);
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return fail(req, res, 'That email address doesn’t look right.', form);
  if (!form.consent) return fail(req, res, 'Please confirm this is your own account.', form);

  let a = null; let p = null;
  try { if (audio) a = saveAudio(audio.buffer); } catch (e) { return fail(req, res, e.message, form); }
  try { if (photo) p = await savePhoto(photo.buffer); } catch { return fail(req, res, 'That photo couldn’t be read. Try a JPG or PNG.', form); }

  db.prepare(`INSERT INTO submissions (name, email, celebrity, location_name, location_address, seen_when, story, photo_file, audio_file, audio_mime, visitor)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(form.name, form.email, form.celebrity, form.location_name, form.location_address,
    form.seen_when, form.story, p, a?.file ?? null, a?.mime ?? null, visitorId(req));
  done(req, res);
});

const wantsJson = (req) => req.get('accept')?.includes('application/json');
function done(req, res) {
  if (wantsJson(req)) return res.json({ ok: true, redirect: '/send-a-rumor?sent=1' });
  res.redirect(303, '/send-a-rumor?sent=1');
}
function fail(req, res, error, form = {}) {
  if (wantsJson(req)) return res.status(400).json({ error });
  send(res, sendRumorPage(res, { token: signToken('tip', 0), error, form }), 400);
}

router.use((req, res) => {
  // Articles removed by the one-month expiry answer 410 Gone, so search engines drop them quickly.
  const m = req.path.match(/^\/rumor\/([a-z0-9-]+)(\.md)?$/);
  const gone = m && db.prepare('SELECT 1 FROM removed_articles WHERE slug = ?').get(m[1]);
  send(res, notFoundPage(res), gone ? 410 : 404);
});
