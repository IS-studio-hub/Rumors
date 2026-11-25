// Web radar: once a day, search the news web for Toronto celebrity sightings and rumours,
// score each result for relevance, and save the good ones for the admin to review.
//
// Sources (no API keys needed):
//   - Google News search RSS (covers blogTO, Toronto Life, Toronto Star, CP24, People, Page Six, etc.)
//   - Toronto outlet feeds (Daily Hive Toronto, Narcity Toronto), keyword-filtered
// Only the headline, a short snippet and the link are stored. Never republish source text.
import { db, getSetting, setSetting } from './db.js';
import { list } from './html.js';

export const QUESTIONS = [
  { key: 'now', label: 'Which celebrities are in Toronto right now?',
    queries: ['"spotted in Toronto"', '"seen in Toronto" celebrity', 'celebrity "in Toronto" spotted', '"Toronto sighting" celebrity'] },
  { key: 'venue', label: 'Which celebrities have visited a particular Toronto restaurant or bar?',
    queries: ['celebrity spotted Toronto restaurant', 'celebrity spotted Toronto bar', 'celebrity dined Toronto restaurant'] },
  { key: 'tiff', label: 'Where do celebrities go during TIFF?',
    queries: ['TIFF celebrities spotted', 'TIFF party celebrities Toronto', 'TIFF celebrity restaurant Yorkville'] },
  { key: 'live', label: 'Which celebrities live in or visit Toronto?',
    queries: ['celebrity "lives in Toronto"', 'celebrity "moved to Toronto"', 'celebrity visits Toronto', 'celebrity "filming in Toronto"'] },
  { key: 'person', label: 'Where was a particular actor, singer, or influencer spotted?',
    queries: [] }, // built per celebrity from the watchlist
  { key: 'event', label: 'What happened at a Toronto event last night?',
    queries: ['Toronto red carpet celebrities', 'Toronto gala celebrities', 'Toronto concert surprise guest', 'Toronto party celebrities night'] },
  { key: 'hotspot', label: 'Which Toronto restaurants are popular with celebrities?',
    queries: ['Toronto restaurant celebrities favourite', 'celebrity hotspot Toronto', 'where celebrities eat in Toronto'] },
];

const OUTLET_FEEDS = [
  { name: 'Daily Hive Toronto', url: 'https://dailyhive.com/feed/toronto' },
  { name: 'Narcity Toronto', url: 'https://www.narcity.com/feeds/toronto.rss' },
];

export const DEFAULT_CELEBS = [
  'Drake', 'The Weeknd', 'Justin Bieber', 'Shawn Mendes', 'Ryan Reynolds', 'Ryan Gosling', 'Keanu Reeves', 'Rachel McAdams',
  'Simu Liu', 'Lilly Singh', 'Mike Myers', 'Seth Rogen', 'Celine Dion', 'Avril Lavigne', 'Michael Bublé', 'Nina Dobrev',
  'Shay Mitchell', 'Elliot Page', 'Sandra Oh', 'Jim Carrey', 'Taylor Swift', 'Selena Gomez', 'Leonardo DiCaprio',
  'Jennifer Lopez', 'Rihanna', 'Kylie Jenner', 'Kim Kardashian', 'Bad Bunny', 'Travis Scott', 'Pedro Pascal',
  'Timothée Chalamet', 'Zendaya', 'Harry Styles', 'Paul Mescal', 'Jacob Elordi',
];

export const DEFAULT_PLACES = [
  'Yorkville', 'King West', 'Ossington', 'Queen West', 'Distillery District', 'Entertainment District', 'Leslieville',
  'Sotto Sotto', 'Hazelton Hotel', 'Four Seasons', 'Soho House', 'Bisha', 'Kost', 'Drake Hotel', 'Shangri-La', 'St. Regis',
  'Ritz-Carlton', 'Fairmont Royal York', 'Nobu', 'Byblos', 'Prime Seafood Palace', 'Kiin', 'Pai', 'Jacobs & Co',
  'Estiatorio Milos', 'Adrak', 'Vinny', 'Silent H', 'Scotiabank Arena', 'Rogers Centre', 'TIFF Lightbox',
  'Roy Thomson Hall', 'Princess of Wales Theatre', 'Casa Loma', 'CN Tower', 'Eataly', 'Holt Renfrew',
];

/** Celebrities and places to watch: admin-editable, plus everyone/everywhere already on the site. */
export function watchlists() {
  const site = db.prepare("SELECT celebrities, location_name, neighbourhood FROM articles WHERE status = 'published'").all();
  const celebs = new Set([...list(getSetting('radar_celebs', DEFAULT_CELEBS.join(', '))), ...site.flatMap((a) => list(a.celebrities))]);
  const places = new Set([...list(getSetting('radar_places', DEFAULT_PLACES.join(', '))), ...site.flatMap((a) => [a.location_name, a.neighbourhood]).filter(Boolean)]);
  return { celebs: [...celebs], places: [...places] };
}

// ---------- tiny RSS/Atom parser ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#'
      ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : ENT[e.toLowerCase()] ?? m));
}
const strip = (s) => decode(decode(s)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml, name) => (xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')) || [])[1] || '';

function parseFeed(xml, fallbackSource) {
  const items = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return items.map((it) => {
    const source = strip(tag(it, 'source')) || fallbackSource;
    let title = strip(tag(it, 'title'));
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = strip(tag(it, 'link')) || (it.match(/<link[^>]+href="([^"]+)"/i) || [])[1] || '';
    const date = strip(tag(it, 'pubDate') || tag(it, 'published') || tag(it, 'updated'));
    let snippet = strip(tag(it, 'description') || tag(it, 'summary'));
    if (snippet.startsWith(title)) snippet = snippet.slice(title.length).replace(/^\s*[-|:]?\s*/, '');
    if (source && snippet.endsWith(source)) snippet = snippet.slice(0, -source.length).trim();
    const d = new Date(date);
    return { title, link, source, snippet: snippet.slice(0, 300), published_at: Number.isNaN(d.getTime()) ? null : d.toISOString() };
  }).filter((x) => x.title && /^https?:\/\//.test(x.link));
}

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'RumorsRadar/1.0 (news monitor)', Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.text();
}

const googleNews = (q, days) => `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${days}d`)}&hl=en-CA&gl=CA&ceid=CA:en`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- scoring ----------
const MIN_SCORE = 6;
const TORONTO = /\b(toronto|torontonian|the 6ix|tiff|yorkville|scarborough|etobicoke|north york|mississauga)\b/i;
const SIGHTING = /\b(spotted|sighting|sightings|seen (at|in|out|with)|was seen|dined|dines|dining|grab(s|bed)? (dinner|lunch|drinks|coffee|ice cream|a bite)|grabs|party|parties|partied|partying|hung out|hanging out|hangs out|out and about|stop(s|ped)? by|show(s|ed)? up|surprise(s|d)? |surprise (appearance|guest)|celebrat(es|ed|ing)|visit(s|ed|ing)|shopp?(s|ed|ing)|enjoy(s|ed|ing)|gift(s|ed)|checks? out|hit(s)? up|courtside|paparazzi|caught)\b/i;
const LIVING = /\b(lives in|living in|moved to|moving to|home in|penthouse|mansion|condo|house in|hometown|grew up)\b/i;
const CELEB_WORDS = /\b(celebrit(y|ies)|celeb|celebs|a-lister|movie star|pop star|actor|actress|singer|rapper|influencer|hollywood|cast)\b/i;
const EVENT = /\b(last night|red carpet|gala|premiere|concert|party|after-party|afterparty|festival|awards|game|courtside|show)\b/i;
const FOOD = /\b(restaurant|bar|lounge|dinner|brunch|lunch|steakhouse|club|nightclub|patio|café|cafe|ice cream|bakery|hotel)\b/i;
// Stories that are not celebrity sightings (or that we never want as leads: crime, accidents).
const NOISE = /\b(waymo|vehicles?|cars?|robots?|hippo|coyote|bear|raccoon|weather|storm|crash|police|shooting|stabbing|lawsuit|charged|arrest(ed)?|home invasion|obituary|dies|died)\b/i;
const NAME_LIKE = /\b[A-Z][a-zà-ÿ’']+ (?:[A-Z][a-zà-ÿ’']+ )?[A-Z][a-zà-ÿ’']+\b/;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matchAll = (text, names) => names.filter((n) => n.length > 2 && new RegExp(`(^|[^\\p{L}])${esc(n)}($|[^\\p{L}])`, 'iu').test(text));

export function score(item, { celebs, places }, questionKey) {
  const text = `${item.title} ${item.snippet}`;
  const foundCelebs = matchAll(text, celebs);
  const foundPlaces = matchAll(text, places);
  const sighting = SIGHTING.test(text);
  const living = LIVING.test(text);
  const toronto = TORONTO.test(text) || foundPlaces.length > 0;
  // Is there a person in the story? A watched celebrity, a celebrity word, or a name doing something.
  const person = foundCelebs.length ? 3 : (NAME_LIKE.test(item.title) && (sighting || living)) ? 2 : CELEB_WORDS.test(text) ? 1 : 0;
  let s = 0;
  if (toronto) s += 3;
  s += person;
  if (sighting || living) s += 2;
  if (foundPlaces.length) s += 2;
  if (EVENT.test(text)) s += 1;
  if (item.published_at && Date.now() - new Date(item.published_at).getTime() < 2 * 864e5) s += 1;
  if (NOISE.test(text)) s -= 3;
  if (!person) s = Math.min(s, MIN_SCORE - 1);
  // Which of the admin's questions this helps answer.
  const qs = new Set([questionKey]);
  if (/\btiff\b|film festival/i.test(text)) qs.add('tiff');
  if (EVENT.test(text)) qs.add('event');
  if (FOOD.test(text) && person) qs.add('venue');
  if (FOOD.test(text) && /\b(favourite|favorite|celebrity-favourite|hotspot|hot spot|where celebrities)\b/i.test(text)) qs.add('hotspot');
  if (person && sighting) qs.add('person');
  if (person && sighting && toronto) qs.add('now');
  if (living) qs.add('live');
  return { score: Math.max(0, s), toronto, celebrities: foundCelebs, places: foundPlaces, questions: [...qs] };
}

const titleKey = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
const STOP = new Set('a an the and or of in at on to for with from by as is are was his her their its after before during new this that how why what who will be has have just'.split(' '));
const words = (t) => new Set(t.toLowerCase().replace(/[^a-z0-9$]+/g, ' ').split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
function similar(a, b) {
  const A = words(a); const B = words(b);
  let both = 0; for (const w of A) if (B.has(w)) both++;
  return both / Math.max(1, Math.min(A.size, B.size));
}

// ---------- the scan ----------
let running = false;
export const isRunning = () => running;

export async function runScan(trigger = 'schedule') {
  if (running) return { skipped: true };
  running = true;
  const run = db.prepare('INSERT INTO radar_runs (started_at, trigger) VALUES (?, ?)').run(new Date().toISOString(), trigger);
  const runId = run.lastInsertRowid;
  const errors = [];
  let checked = 0; let added = 0;
  const lists = watchlists();
  // First scan looks back a month to fill the list; daily scans look back a week (duplicates are skipped).
  const days = getSetting('radar_last_run') ? 7 : 30;

  const insert = db.prepare(`INSERT OR IGNORE INTO web_finds (url, title_key, title, source, snippet, published_at, questions, celebrities, places, score)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const seenTitle = db.prepare('SELECT id FROM web_finds WHERE title_key = ?');
  const bump = db.prepare('UPDATE web_finds SET mentions = mentions + 1 WHERE id = ?');
  const bumped = new Set(); // count each outlet's copy once per scan
  const blocked = db.prepare('SELECT 1 FROM web_find_blocks WHERE title_key = ? OR url = ?');

  function consider(items, questionKey, requireToronto) {
    for (const it of items) {
      checked++;
      const r = score(it, lists, questionKey);
      if (r.score < MIN_SCORE || (requireToronto && !r.toronto)) continue;
      // Only the last week matters: older items are never stored.
      if (it.published_at && Date.now() - new Date(it.published_at).getTime() > KEEP_DAYS * 864e5) continue;
      const key = titleKey(it.title);
      const dup = seenTitle.get(key);
      if (dup) { if (!bumped.has(`${dup.id}|${it.link}`)) { bumped.add(`${dup.id}|${it.link}`); if (it.link !== db.prepare('SELECT url FROM web_finds WHERE id = ?').get(dup.id)?.url) bump.run(dup.id); } continue; } // same story from another link
      if (blocked.get(key, it.link)) continue; // deleted forever by an admin
      // Same story told by another outlet (e.g. ten sites covering one Drake moment): keep only the first.
      const recent = db.prepare("SELECT id, title, url FROM web_finds WHERE found_at > datetime('now','-21 days') AND celebrities = ? ORDER BY id DESC LIMIT 200").all(r.celebrities.join(', '));
      const same = recent.find((x) => similar(x.title, it.title) >= 0.5);
      if (same) { if (same.url !== it.link && !bumped.has(`${same.id}|${it.link}`)) { bumped.add(`${same.id}|${it.link}`); bump.run(same.id); } continue; }
      const res = insert.run(it.link, key, it.title.slice(0, 300), it.source.slice(0, 120), it.snippet, it.published_at,
        r.questions.join(','), r.celebrities.join(', '), r.places.join(', '), r.score);
      if (res.changes) added++;
    }
  }

  // Build today's searches: the question queries + a rotating slice of the celebrity watchlist.
  const searches = QUESTIONS.flatMap((q) => q.queries.map((query) => ({ query, key: q.key })));
  const day = Math.floor(Date.now() / 864e5);
  const PER_DAY = 15;
  const start = (day * PER_DAY) % Math.max(1, lists.celebs.length);
  const todaysCelebs = [...lists.celebs, ...lists.celebs].slice(start, start + Math.min(PER_DAY, lists.celebs.length));
  for (const name of todaysCelebs) searches.push({ query: `"${name}" Toronto`, key: 'person' });

  try {
    for (const s of searches) {
      try { consider(parseFeed(await fetchFeed(googleNews(s.query, days)), ''), s.key, true); }
      catch (e) { errors.push(`${s.query}: ${e.message}`); }
      await sleep(1200); // be polite
    }
    for (const f of OUTLET_FEEDS) {
      try { consider(parseFeed(await fetchFeed(f.url), f.name), 'now', false); }
      catch (e) { errors.push(`${f.name}: ${e.message}`); }
    }
    pruneFinds();
    db.prepare("DELETE FROM web_find_blocks WHERE created_at < datetime('now','-180 days')").run();
  } finally {
    db.prepare('UPDATE radar_runs SET finished_at = ?, checked = ?, added = ?, errors = ? WHERE id = ?')
      .run(new Date().toISOString(), checked, added, errors.slice(0, 20).join('\n'), runId);
    setSetting('radar_last_run', new Date().toISOString());
    running = false;
  }
  return { checked, added, errors: errors.length };
}

/** Keep only the last week of finds (by publish date). ★ Saved finds are kept until unsaved. */
export const KEEP_DAYS = 7;
export function pruneFinds() {
  return db.prepare(`DELETE FROM web_finds WHERE status <> 'saved'
    AND COALESCE(published_at, found_at) < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${KEEP_DAYS} days')`).run().changes;
}

/** Runs the scan once a day, shortly after 6 a.m. Toronto time (or at startup if a day was missed). */
export function startRadarSchedule() {
  const tick = () => {
    if (running || process.env.RADAR_DISABLED === 'true') return;
    const now = new Date();
    const torontoDay = now.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    const hour = Number(now.toLocaleString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', hour12: false }));
    const last = getSetting('radar_last_run');
    const lastDay = last ? new Date(last).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }) : '';
    if (lastDay !== torontoDay && hour >= 6) runScan('schedule').catch((e) => console.error('Radar scan failed:', e));
  };
  setTimeout(tick, 30_000).unref();
  setInterval(tick, 20 * 60 * 1000).unref();
}

export function nextRunLabel() {
  const now = new Date();
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const hour = Number(now.toLocaleString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', hour12: false }));
  const last = getSetting('radar_last_run');
  const lastDay = last ? new Date(last).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }) : '';
  if (lastDay === today) return 'tomorrow after 6:00 a.m. (Toronto time)';
  return hour >= 6 ? 'within the next 20 minutes' : 'today after 6:00 a.m. (Toronto time)';
}
