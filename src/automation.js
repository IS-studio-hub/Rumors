// Automatic jobs on the live site:
//  1. Weekly article: every Monday after 10 a.m. Toronto time, the hottest rumour of the past week
//     on Web radar is written up by the AI writer and PUBLISHED automatically.
//  2. Article expiry: once a day, published articles older than 30 days are deleted (their URLs
//     then answer "410 Gone"), along with images no other article uses.
// Both can be switched off in admin → Web radar → Automation. AUTOMATION_DISABLED=true turns off both.
import { db, getSetting, setSetting, tx } from './db.js';
import { deleteImage, imageUsage } from './images.js';
import { aiEnabled, startDraft, jobFor } from './ai-writer.js';
import { pruneFinds, KEEP_DAYS } from './radar.js';

export const EXPIRE_DAYS = 30;
const WEEKLY_DAY = 1; // Monday
const WEEKLY_HOUR = 10;
const MAX_TRIES = 3;

export const isOn = (key) => getSetting(key, 'on') === 'on';
const disabled = () => process.env.AUTOMATION_DISABLED === 'true';

const toronto = (d = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(d).map((p) => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: day };
};
/** The Monday (Toronto date) that starts the week containing `d`. */
function weekKey(d = new Date()) {
  const t = toronto(d);
  const back = (t.weekday + 6) % 7;
  return toronto(new Date(d.getTime() - back * 864e5)).date;
}

// ---------- 1. Weekly article ----------

/** Hottest find of the last week: relevance + how many outlets covered it + freshness. */
export function hottestFind() {
  const rows = db.prepare(`SELECT * FROM web_finds WHERE status IN ('new','saved') AND article_id IS NULL AND celebrities <> ''
    AND COALESCE(published_at, found_at) >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-${KEEP_DAYS} days')`).all();
  const heat = (f) => {
    const ageDays = (Date.now() - new Date(f.published_at || f.found_at).getTime()) / 864e5;
    return f.score + 2 * Math.min(f.mentions || 1, 8) + (f.status === 'saved' ? 3 : 0) - ageDays * 0.5;
  };
  return rows.sort((a, b) => heat(b) - heat(a))[0] || null;
}

export function weeklyStatus() {
  return {
    on: isOn('auto_weekly'), last: getSetting('weekly_last_article'), lastWeek: getSetting('weekly_done_week'),
    error: getSetting('weekly_last_error'), writing: jobFor('weekly')?.state === 'writing',
    next: (() => {
      if (getSetting('weekly_done_week') === weekKey()) return 'next Monday after 10:00 a.m. (Toronto time)';
      const t = toronto();
      return t.weekday === WEEKLY_DAY && t.hour < WEEKLY_HOUR ? 'today after 10:00 a.m. (Toronto time)' : 'within the next 20 minutes';
    })(),
  };
}

/** Start this week's article now (also used by the "Publish now" button). Returns a message. */
export function runWeekly(trigger = 'schedule') {
  if (!aiEnabled()) { setSetting('weekly_last_error', 'No AI key set (OPENAI_API_KEY or ANTHROPIC_API_KEY).'); return 'No AI key is set, so the weekly article can’t be written.'; }
  if (jobFor('weekly')?.state === 'writing') return 'This week’s article is already being written.';
  const f = hottestFind();
  if (!f) { setSetting('weekly_last_error', `No rumour from the last ${KEEP_DAYS} days to write about.`); return 'No rumours from the last week to write about yet.'; }
  const week = weekKey();
  if (trigger === 'schedule') { const [w, n] = getSetting('weekly_tries').split(':'); setSetting('weekly_tries', `${week}:${w === week ? Number(n) + 1 : 1}`); }
  db.prepare("UPDATE web_finds SET status = 'saved' WHERE id = ?").run(f.id); // keep it while writing
  startDraft('weekly', { kind: 'radar', title: f.title, url: f.url, source: f.source, snippet: f.snippet, published_at: f.published_at, celebrity: f.celebrities, place: f.places }, {
    onDone: (articleId) => {
      const now = new Date().toISOString();
      tx(() => {
        db.prepare("UPDATE articles SET status = 'published', published_at = ?, featured = 1, updated_at = ? WHERE id = ?").run(now, now, articleId);
        db.prepare("UPDATE web_finds SET status = 'used', article_id = ? WHERE id = ?").run(articleId, f.id);
      });
      const a = db.prepare('SELECT title, slug FROM articles WHERE id = ?').get(articleId);
      setSetting('weekly_done_week', week);
      setSetting('weekly_last_article', JSON.stringify({ id: articleId, title: a.title, slug: a.slug, at: now }));
      setSetting('weekly_last_error', '');
      console.log(`Weekly article published: ${a.title}`);
    },
    onError: (msg) => {
      db.prepare("UPDATE web_finds SET status = 'new' WHERE id = ? AND status = 'saved'").run(f.id);
      setSetting('weekly_last_error', msg);
    },
  });
  return `Writing this week’s article about “${f.title}”. It will be published automatically in 1 to 3 minutes.`;
}

function weeklyTick() {
  if (!isOn('auto_weekly')) return;
  const t = toronto();
  const week = weekKey();
  if (getSetting('weekly_done_week') === week) return;
  // Monday after 10 a.m., or later in the week if Monday was missed (server asleep, no finds yet).
  if (t.weekday === WEEKLY_DAY && t.hour < WEEKLY_HOUR) return;
  const [w, n] = getSetting('weekly_tries').split(':');
  if (w === week && Number(n) >= MAX_TRIES) return;
  runWeekly('schedule');
}

// ---------- 2. Article expiry ----------

export function expireArticles() {
  const old = db.prepare(`SELECT id, slug, title, cover_image_id, body FROM articles WHERE status = 'published'
    AND published_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-${EXPIRE_DAYS} days')`).all();
  for (const a of old) {
    const imgs = new Set([a.cover_image_id, ...[...a.body.matchAll(/\(image:(\d+)\)/g)].map((m) => Number(m[1]))].filter(Boolean));
    tx(() => {
      db.prepare('INSERT OR REPLACE INTO removed_articles (slug, title) VALUES (?, ?)').run(a.slug, a.title);
      db.prepare('DELETE FROM articles WHERE id = ?').run(a.id);
    });
    for (const id of imgs) if (!imageUsage(id).length) deleteImage(id);
    console.log(`Expired article (older than ${EXPIRE_DAYS} days): ${a.title}`);
  }
  if (old.length) setSetting('expire_last', JSON.stringify({ count: old.length, at: new Date().toISOString() }));
  return old.length;
}

export const expiringSoon = (days = 7) => db.prepare(`SELECT id, title, published_at FROM articles WHERE status = 'published'
  AND published_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-${EXPIRE_DAYS - days} days') ORDER BY published_at`).all();

function dailyTick() {
  const today = toronto().date;
  if (getSetting('daily_housekeeping') === today) return;
  setSetting('daily_housekeeping', today);
  pruneFinds();
  if (isOn('auto_expire')) expireArticles();
}

export function startAutomation() {
  if (disabled()) { console.log('Automation is off (AUTOMATION_DISABLED=true).'); return; }
  const tick = () => {
    try { dailyTick(); weeklyTick(); } catch (e) { console.error('Automation tick failed:', e); }
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 20 * 60 * 1000).unref();
}
