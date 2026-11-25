import express from 'express';
import multer from 'multer';
import { db, refreshCommentCount, tx } from '../db.js';
import { send } from '../views/layout.js';
import fs from 'node:fs';
import { loginPage, dashboardPage, editorPage, mediaPage, commentsPage, submissionsPage, submissionPage, radarPage } from '../views/admin.js';
import { filePath, deleteSubmission } from '../submissions.js';
import { QUESTIONS, runScan, isRunning, nextRunLabel, DEFAULT_CELEBS, DEFAULT_PLACES } from '../radar.js';
import { getSetting, setSetting } from '../db.js';
import { STORED, autoCategories } from '../categories.js';
import { createSession, destroySession, verifyPassword, requireAdmin, requireCsrf, rateLimit, hashPassword } from '../security.js';
import { rankedArticles, uniqueSlug } from '../articles.js';
import { createImage, replaceImage, deleteImage, getImage, imageUsage, publicImage } from '../images.js';
import { renderMarkdown } from '../markdown.js';
import { slugify } from '../html.js';
import { aiEnabled, startDraft, jobFor } from '../ai-writer.js';

export const router = express.Router();

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20, fields: 40 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
});
// multer must run before CSRF check on multipart forms (the token is a form field).
const multipart = (spec) => (req, res, next) => spec(req, res, (err) => {
  if (err) return res.redirect(303, `${req.get('referer') ? new URL(req.get('referer')).pathname : '/admin'}?err=${encodeURIComponent(err.code === 'LIMIT_FILE_SIZE' ? 'Image too large (max 15 MB).' : 'Upload failed.')}`);
  next();
});

router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });

// ---------- Auth ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many sign-in attempts. Try again in 15 minutes.' });
const DUMMY_HASH = await hashPassword('timing-equaliser-' + Math.random());

router.get('/login', (req, res) => (req.admin ? res.redirect(303, '/admin') : send(res, loginPage(req, res))));

router.post('/login', loginLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim().slice(0, 80);
  const password = String(req.body.password || '').slice(0, 200);
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return send(res, loginPage(req, res, { error: 'Incorrect username or password.', username }), 401);
  createSession(res, user.id);
  res.redirect(303, '/admin');
});

router.use(requireAdmin);

router.post('/logout', requireCsrf, (req, res) => { destroySession(req, res); res.redirect(303, '/admin/login'); });

// ---------- Articles ----------
router.get('/', (req, res) => {
  const filter = ['published', 'draft'].includes(req.query.status) ? req.query.status : 'all';
  const q = String(req.query.q || '').trim().slice(0, 100);
  const { trending } = rankedArticles();
  const rankById = new Map(trending.map((a) => [a.id, a]));
  let rows = db.prepare('SELECT * FROM articles ORDER BY COALESCE(published_at, created_at) DESC').all();
  if (filter !== 'all') rows = rows.filter((a) => a.status === filter);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((a) => [a.title, a.celebrities, a.location_name, a.neighbourhood, a.tags].join(' ').toLowerCase().includes(needle));
  }
  rows = rows.map((a) => ({ ...a, rank: rankById.get(a.id)?.rank, score: rankById.get(a.id)?.score }))
    .sort((x, y) => (x.rank ?? 1e9) - (y.rank ?? 1e9));
  const totals = db.prepare(`SELECT SUM(status='published') published, SUM(status='draft') drafts,
    COALESCE(SUM(views),0) views, COALESCE(SUM(comments_count),0) comments FROM articles`).get();
  send(res, dashboardPage(req, res, { articles: rows, totals: { published: totals.published || 0, drafts: totals.drafts || 0, views: totals.views, comments: totals.comments }, filter, q }));
});

const EMPTY = { id: 0, title: '', slug: '', excerpt: '', body: '', cover_image_id: null, location_name: '', location_address: '', neighbourhood: '',
  celebrities: '', tags: '', categories: '', faq: '', meta_title: '', meta_description: '', author_name: 'Rumors Toronto', status: 'draft', featured: 0, published_at: '' };

router.get('/articles/new', (req, res) => send(res, editorPage(req, res, { a: EMPTY })));

router.get('/articles/:id/edit', (req, res, next) => {
  const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(Number(req.params.id));
  if (!a) return next();
  send(res, editorPage(req, res, { a }));
});

const s = (v, max) => String(v ?? '').trim().slice(0, max);
const csvClean = (v) => s(v, 400).split(',').map((x) => x.trim()).filter(Boolean).join(', ');

// Store the editor's choice only when it differs from the automatic sorting,
// so articles keep following their tags until someone picks categories by hand.
function chosenCategories(b) {
  const picked = [].concat(b.categories || []).map(String).filter((x) => STORED.some((c) => c.slug === x));
  const auto = autoCategories({ tags: s(b.tags, 400), location_name: s(b.location_name, 120), celebrities: s(b.celebrities, 400) });
  const same = picked.length === auto.length && picked.every((x) => auto.includes(x));
  return same ? '' : picked.join(',');
}

async function readArticleForm(req, id = 0) {
  const b = req.body;
  const title = s(b.title, 160);
  let published_at = null;
  if (b.published_at) { const d = new Date(b.published_at); if (!Number.isNaN(d.getTime())) published_at = d.toISOString(); }
  const status = b.status === 'published' ? 'published' : 'draft';
  if (status === 'published' && !published_at) published_at = new Date().toISOString();
  let cover = b.cover_image_id ? Number(b.cover_image_id) : null;
  if (cover && !getImage(cover)) cover = null;
  const file = req.files?.cover_file?.[0];
  if (file) cover = (await createImage(file.buffer, { originalName: file.originalname, alt: s(b.cover_alt, 300) || title })).id;
  return {
    title, slug: uniqueSlug(s(b.slug, 90) || title, id), excerpt: s(b.excerpt, 300), body: s(b.body, 100000),
    cover_image_id: cover, location_name: s(b.location_name, 120), location_address: s(b.location_address, 200),
    neighbourhood: s(b.neighbourhood, 80), celebrities: csvClean(b.celebrities), tags: csvClean(b.tags),
    faq: s(b.faq, 10000), meta_title: s(b.meta_title, 120), meta_description: s(b.meta_description, 300),
    author_name: s(b.author_name, 80) || 'Rumors Toronto', status, featured: b.featured ? 1 : 0, published_at,
    categories: chosenCategories(b),
  };
}

const COLS = ['title', 'slug', 'excerpt', 'body', 'cover_image_id', 'location_name', 'location_address', 'neighbourhood', 'celebrities',
  'tags', 'faq', 'meta_title', 'meta_description', 'author_name', 'status', 'featured', 'published_at', 'categories'];
const articleFields = multipart(upload.fields([{ name: 'cover_file', maxCount: 1 }]));

router.post('/articles', articleFields, requireCsrf, async (req, res) => {
  try {
    const a = await readArticleForm(req);
    if (!a.title) return send(res, editorPage(req, res, { a: { ...EMPTY, ...a }, error: 'A headline is required.' }), 400);
    const info = db.prepare(`INSERT INTO articles (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`).run(...COLS.map((c) => a[c]));
    res.redirect(303, `/admin/articles/${info.lastInsertRowid}/edit?msg=created`);
  } catch (e) {
    send(res, editorPage(req, res, { a: { ...EMPTY, ...req.body }, error: `Could not save: ${e.message}` }), 400);
  }
});

router.post('/articles/:id', articleFields, requireCsrf, async (req, res, next) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
  if (!existing) return next();
  try {
    const a = await readArticleForm(req, id);
    if (!a.title) return send(res, editorPage(req, res, { a: { ...existing, ...a }, error: 'A headline is required.' }), 400);
    db.prepare(`UPDATE articles SET ${COLS.map((c) => `${c}=?`).join(',')}, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
      .run(...COLS.map((c) => a[c]), id);
    res.redirect(303, `/admin/articles/${id}/edit?msg=saved`);
  } catch (e) {
    send(res, editorPage(req, res, { a: { ...existing, ...req.body }, error: `Could not save: ${e.message}` }), 400);
  }
});

router.post('/articles/:id/delete', requireCsrf, (req, res) => {
  db.prepare('DELETE FROM articles WHERE id = ?').run(Number(req.params.id));
  res.redirect(303, '/admin?msg=deleted');
});

// ---------- Images ----------
router.get('/media', (req, res) => {
  const images = db.prepare('SELECT * FROM images ORDER BY updated_at DESC').all().map((img) => ({ img, usage: imageUsage(img.id) }));
  send(res, mediaPage(req, res, { images }));
});

router.post('/media', multipart(upload.array('files', 20)), requireCsrf, async (req, res) => {
  if (!req.files?.length) return res.redirect(303, '/admin/media?err=' + encodeURIComponent('Choose at least one JPG, PNG, WebP, AVIF or GIF image.'));
  try {
    for (const f of req.files) await createImage(f.buffer, { originalName: f.originalname, alt: s(req.body.alt, 300) });
    res.redirect(303, '/admin/media?msg=uploaded');
  } catch { res.redirect(303, '/admin/media?err=' + encodeURIComponent('One of the files is not a valid image.')); }
});

router.post('/media/:id', requireCsrf, (req, res) => {
  db.prepare(`UPDATE images SET alt=?, credit=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
    .run(s(req.body.alt, 300), s(req.body.credit, 200), Number(req.params.id));
  res.redirect(303, '/admin/media?msg=imgsaved');
});

router.post('/media/:id/replace', multipart(upload.single('file')), requireCsrf, async (req, res) => {
  if (!req.file) return res.redirect(303, '/admin/media?err=' + encodeURIComponent('Choose a JPG, PNG, WebP, AVIF or GIF image.'));
  try { await replaceImage(Number(req.params.id), req.file.buffer, req.file.originalname); res.redirect(303, '/admin/media?msg=replaced'); }
  catch { res.redirect(303, '/admin/media?err=' + encodeURIComponent('That file is not a valid image.')); }
});

router.post('/media/:id/delete', requireCsrf, (req, res) => {
  deleteImage(Number(req.params.id));
  res.redirect(303, '/admin/media?msg=imgdeleted');
});

// JSON endpoints for the editor's image picker and live preview.
router.get('/api/media', (req, res) => {
  res.json(db.prepare('SELECT * FROM images ORDER BY updated_at DESC LIMIT 300').all().map(publicImage));
});
router.post('/api/media', multipart(upload.single('file')), requireCsrf, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, WebP, AVIF or GIF image.' });
  try { res.json(publicImage(await createImage(req.file.buffer, { originalName: req.file.originalname, alt: s(req.body.alt, 300) }))); }
  catch { res.status(400).json({ error: 'That file is not a valid image.' }); }
});
router.post('/api/preview', express.json({ limit: '200kb' }), requireCsrf, (req, res) => {
  res.json({ html: renderMarkdown(String(req.body?.body || '')) });
});

// ---------- Comments ----------
router.get('/comments', (req, res) => {
  const filter = ['pending', 'visible', 'hidden'].includes(req.query.status) ? req.query.status : 'all';
  const comments = db.prepare(`SELECT c.*, a.title, a.slug FROM comments c JOIN articles a ON a.id = c.article_id
    ${filter === 'all' ? '' : 'WHERE c.status = ?'} ORDER BY (c.status = 'pending') DESC, c.created_at DESC LIMIT 300`)
    .all(...(filter === 'all' ? [] : [filter]));
  send(res, commentsPage(req, res, { comments, filter }));
});

function setCommentStatus(id, status) {
  const c = db.prepare('SELECT article_id FROM comments WHERE id = ?').get(id);
  if (!c) return;
  tx(() => {
    if (status) db.prepare('UPDATE comments SET status = ? WHERE id = ?').run(status, id);
    else db.prepare('DELETE FROM comments WHERE id = ?').run(id);
    refreshCommentCount(c.article_id);
  });
}
const back = (req, msg) => {
  const ref = req.get('referer');
  const u = ref ? new URL(ref) : null;
  return `/admin/comments?${u?.searchParams.get('status') ? `status=${slugify(u.searchParams.get('status'))}&` : ''}msg=${msg}`;
};
router.post('/comments/:id/approve', requireCsrf, (req, res) => { setCommentStatus(Number(req.params.id), 'visible'); res.redirect(303, back(req, 'comment')); });
router.post('/comments/:id/hide', requireCsrf, (req, res) => { setCommentStatus(Number(req.params.id), 'hidden'); res.redirect(303, back(req, 'comment')); });
router.post('/comments/:id/delete', requireCsrf, (req, res) => { setCommentStatus(Number(req.params.id), null); res.redirect(303, back(req, 'commentdeleted')); });

// ---------- Reader rumor tips ----------
router.get('/submissions', (req, res) => {
  const filter = ['pending', 'approved', 'rejected', 'all'].includes(req.query.status) ? req.query.status : 'pending';
  const subs = db.prepare(`SELECT * FROM submissions ${filter === 'all' ? '' : 'WHERE status = ?'} ORDER BY created_at DESC LIMIT 300`)
    .all(...(filter === 'all' ? [] : [filter]));
  send(res, submissionsPage(req, res, { subs, filter }));
});

const getSub = (id) => db.prepare('SELECT * FROM submissions WHERE id = ?').get(Number(id));

router.get('/submissions/:id', (req, res, next) => {
  const s = getSub(req.params.id);
  if (!s) return next();
  send(res, submissionPage(req, res, { s, job: jobFor(`tip:${s.id}`), aiOn: aiEnabled() }));
});

// Private files: only reachable by a signed-in admin.
router.get('/submissions/:id/:kind', (req, res, next) => {
  if (!['audio', 'photo'].includes(req.params.kind)) return next();
  const s = getSub(req.params.id);
  const file = s && filePath(req.params.kind === 'audio' ? s.audio_file : s.photo_file);
  if (!file || !fs.existsSync(file)) return next();
  res.type(req.params.kind === 'audio' ? s.audio_mime : 'image/webp');
  res.set('Content-Disposition', 'inline');
  res.sendFile(file);
});

router.post('/submissions/:id/approve', requireCsrf, async (req, res, next) => {
  const s = getSub(req.params.id);
  if (!s) return next();
  if (s.article_id && db.prepare('SELECT 1 FROM articles WHERE id = ?').get(s.article_id)) return res.redirect(303, `/admin/articles/${s.article_id}/edit`);
  let cover = null;
  const photo = filePath(s.photo_file);
  if (photo && fs.existsSync(photo)) {
    cover = (await createImage(fs.readFileSync(photo), { originalName: `tip-${s.id}.webp`, alt: `${s.location_name}, Toronto` })).id;
  }
  if (aiEnabled()) {
    startDraft(`tip:${s.id}`, { kind: 'tip', celebrity: s.celebrity, place: s.location_name, address: s.location_address, seen_when: s.seen_when, story: s.story, reporter: s.name },
      { existingCoverId: cover, onDone: (id) => db.prepare("UPDATE submissions SET status = 'approved', article_id = ? WHERE id = ?").run(id, s.id) });
    return res.redirect(303, `/admin/submissions/${s.id}?msg=writing`);
  }
  const story = s.story || '*(This tip was sent as a voice recording. Listen to it under Rumor tips and write the story here.)*';
  const firstSentence = (s.story.match(/^[^.!?\n]{10,220}[.!?]/) || [s.story.slice(0, 200)])[0];
  const title = `${s.celebrity} Spotted at ${s.location_name}`;
  const info = db.prepare(`INSERT INTO articles (slug, title, excerpt, body, cover_image_id, location_name, location_address, neighbourhood, celebrities, author_name, status)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'draft')`).run(uniqueSlug(`${s.celebrity} spotted ${s.location_name} toronto`), title,
    firstSentence || `A reader says they saw ${s.celebrity} at ${s.location_name}.`, story, cover, s.location_name, s.location_address, '',
    s.celebrity, s.name || 'A Rumors reader');
  db.prepare("UPDATE submissions SET status = 'approved', article_id = ? WHERE id = ?").run(info.lastInsertRowid, s.id);
  res.redirect(303, `/admin/articles/${info.lastInsertRowid}/edit?msg=approved`);
});

router.post('/submissions/:id/reject', requireCsrf, (req, res) => {
  db.prepare("UPDATE submissions SET status = 'rejected' WHERE id = ?").run(Number(req.params.id));
  res.redirect(303, '/admin/submissions?msg=subrejected');
});

router.post('/submissions/:id/delete', requireCsrf, (req, res) => {
  deleteSubmission(Number(req.params.id));
  res.redirect(303, '/admin/submissions?status=all&msg=subdeleted');
});

// ---------- Web radar ----------
router.get('/radar', (req, res) => {
  const filter = ['new', 'saved', 'used', 'dismissed', 'all'].includes(req.query.status) ? req.query.status : 'new';
  const question = QUESTIONS.some((x) => x.key === req.query.question) ? req.query.question : '';
  const q = String(req.query.q || '').trim().slice(0, 100);
  const where = []; const args = [];
  if (filter !== 'all') { where.push('status = ?'); args.push(filter); }
  if (question) { where.push("(',' || questions || ',') LIKE ?"); args.push(`%,${question},%`); }
  if (q) { where.push('(title LIKE ? OR celebrities LIKE ? OR places LIKE ? OR snippet LIKE ?)'); args.push(...Array(4).fill(`%${q}%`)); }
  const finds = db.prepare(`SELECT * FROM web_finds ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY (status = 'saved') DESC, COALESCE(published_at, found_at) DESC, score DESC LIMIT 150`).all(...args);
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM web_finds GROUP BY status').all().map((r) => [r.status, r.n]));
  counts.all = Object.values(counts).reduce((x, y) => x + y, 0);
  const qStatus = filter === 'all' ? '' : 'AND status = ?';
  const questions = QUESTIONS.map((x) => ({ ...x, count: db.prepare(`SELECT COUNT(*) n FROM web_finds WHERE (',' || questions || ',') LIKE ? ${qStatus}`).get(`%,${x.key},%`, ...(filter === 'all' ? [] : [filter])).n }));
  send(res, radarPage(req, res, {
    jobFor, aiOn: aiEnabled(), finds, filter, question, q, questions, counts, running: isRunning(), nextRun: nextRunLabel(),
    lastRun: db.prepare('SELECT * FROM radar_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1').get(),
    celebs: getSetting('radar_celebs', DEFAULT_CELEBS.join(', ')), places: getSetting('radar_places', DEFAULT_PLACES.join(', ')),
  }));
});

router.post('/radar/scan', requireCsrf, (req, res) => {
  runScan('manual').catch((e) => console.error('Radar scan failed:', e));
  res.redirect(303, '/admin/radar?msg=scanning');
});

router.post('/radar/watchlists', requireCsrf, (req, res) => {
  const clean = (v) => String(v || '').split(',').map((x) => x.trim().slice(0, 80)).filter(Boolean).slice(0, 300).join(', ');
  setSetting('radar_celebs', clean(req.body.celebs));
  setSetting('radar_places', clean(req.body.places));
  res.redirect(303, '/admin/radar?msg=watchsaved');
});

const radarBack = (req, msg) => {
  const back = new URLSearchParams(String(req.body.back || ''));
  const keep = new URLSearchParams();
  for (const k of ['status', 'question', 'q']) if (back.get(k)) keep.set(k, back.get(k).slice(0, 100));
  if (msg) keep.set('msg', msg);
  return `/admin/radar?${keep}`;
};

// Delete forever (dismissed finds only). The story is remembered so later scans skip it.
const forget = db.prepare("INSERT OR REPLACE INTO web_find_blocks (title_key, url) SELECT title_key, url FROM web_finds WHERE id = ? AND status = 'dismissed'");
const purge = db.prepare("DELETE FROM web_finds WHERE id = ? AND status = 'dismissed'");
router.post('/radar/dismissed/delete-all', requireCsrf, (req, res) => {
  const ids = db.prepare("SELECT id FROM web_finds WHERE status = 'dismissed'").all().map((r) => r.id);
  tx(() => { for (const id of ids) { forget.run(id); purge.run(id); } });
  res.redirect(303, `/admin/radar?status=dismissed&msg=finddeletedall`);
});

router.post('/radar/:id/:action', requireCsrf, (req, res, next) => {
  const f = db.prepare('SELECT * FROM web_finds WHERE id = ?').get(Number(req.params.id));
  if (!f) return next();
  const set = (status) => db.prepare('UPDATE web_finds SET status = ? WHERE id = ?').run(status, f.id);
  switch (req.params.action) {
    case 'save': set('saved'); break;
    case 'unsave': case 'restore': set('new'); break;
    case 'dismiss': set('dismissed'); break;
    case 'delete':
      if (f.status !== 'dismissed') return res.redirect(303, radarBack(req));
      tx(() => { forget.run(f.id); purge.run(f.id); });
      return res.redirect(303, radarBack(req, 'finddeleted'));
    case 'draft': {
      if (aiEnabled()) {
        startDraft(`radar:${f.id}`, { kind: 'radar', title: f.title, url: f.url, source: f.source, snippet: f.snippet, published_at: f.published_at, celebrity: f.celebrities, place: f.places },
          { onDone: (id) => db.prepare("UPDATE web_finds SET status = 'used', article_id = ? WHERE id = ?").run(id, f.id) });
        return res.redirect(303, radarBack(req, 'writing'));
      }
      if (req.body.manual !== '1') return res.redirect(303, `${radarBack(req)}&err=${encodeURIComponent('AI drafts are off: no API key found. Open the .env file, paste your key after OPENAI_API_KEY= (or ANTHROPIC_API_KEY=) and save. No restart needed.')}`);
      const celeb = f.celebrities.split(', ')[0] || '';
      const place = f.places.split(', ')[0] || '';
      const body = `> **Lead from Web radar:** [${f.title.replace(/[\[\]]/g, '')}](${f.url}) via ${f.source || 'the web'}${f.published_at ? `, ${new Date(f.published_at).toDateString()}` : ''}.\n> Verify it, then write the story in your own words. Delete this note before publishing.\n\nStart writing here.`;
      const info = db.prepare(`INSERT INTO articles (slug, title, excerpt, body, location_name, celebrities, status)
        VALUES (?,?,?,?,?,?, 'draft')`).run(uniqueSlug(`${celeb || 'rumor'} spotted ${place || 'toronto'}`),
        celeb ? `${celeb} Spotted${place ? ` at ${place}` : ' in Toronto'}` : f.title.slice(0, 150), '', body, place, f.celebrities);
      db.prepare("UPDATE web_finds SET status = 'used', article_id = ? WHERE id = ?").run(info.lastInsertRowid, f.id);
      return res.redirect(303, `/admin/articles/${info.lastInsertRowid}/edit?msg=drafted`);
    }
    default: return next();
  }
  res.redirect(303, radarBack(req));
});

router.use((req, res) => res.status(404).send('Not found'));
