import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'rumors.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY,
  base TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  original_name TEXT,
  alt TEXT NOT NULL DEFAULT '',
  credit TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  widths TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  cover_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
  location_name TEXT NOT NULL DEFAULT '',
  location_address TEXT NOT NULL DEFAULT '',
  neighbourhood TEXT NOT NULL DEFAULT '',
  celebrities TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  faq TEXT NOT NULL DEFAULT '',
  meta_title TEXT NOT NULL DEFAULT '',
  meta_description TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT 'Rumors Toronto',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  featured INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status, published_at);

CREATE TABLE IF NOT EXISTS view_events (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  visitor TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (article_id, visitor, day)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','pending','hidden')),
  visitor TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_article ON comments(article_id, status, created_at);

-- Reader-submitted rumours ("Send us a rumor"). Files live in DATA_DIR/submissions (never public).
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  celebrity TEXT NOT NULL DEFAULT '',
  location_name TEXT NOT NULL DEFAULT '',
  location_address TEXT NOT NULL DEFAULT '',
  seen_when TEXT NOT NULL DEFAULT '',
  story TEXT NOT NULL DEFAULT '',
  photo_file TEXT,
  audio_file TEXT,
  audio_mime TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  visitor TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status, created_at);

-- Web radar: celebrity sightings found online by the daily scan.
CREATE TABLE IF NOT EXISTS web_finds (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title_key TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  questions TEXT NOT NULL DEFAULT '',
  celebrities TEXT NOT NULL DEFAULT '',
  places TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','saved','dismissed','used')),
  article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  found_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_web_finds_status ON web_finds(status, found_at);
CREATE INDEX IF NOT EXISTS idx_web_finds_title ON web_finds(title_key);

-- Finds deleted forever: remembered so later scans don't add the same story again.
CREATE TABLE IF NOT EXISTS web_find_blocks (
  title_key TEXT PRIMARY KEY,
  url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_web_find_blocks_url ON web_find_blocks(url);

CREATE TABLE IF NOT EXISTS radar_runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  checked INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT '',
  trigger TEXT NOT NULL DEFAULT 'schedule'
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

export const getSetting = (key, fallback = '') => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
export const setSetting = (key, value) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));

/** Recount visible comments for an article (keeps ranking accurate after moderation). */
export function refreshCommentCount(articleId) {
  db.prepare(`UPDATE articles SET comments_count =
    (SELECT COUNT(*) FROM comments WHERE article_id = ? AND status = 'visible') WHERE id = ?`).run(articleId, articleId);
}

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
