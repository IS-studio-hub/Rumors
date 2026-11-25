// On first start of a fresh server, load content/bundle.json (made by `npm run export-content`).
// Runs only while the database has no articles, so it never overwrites live data.
import fs from 'node:fs';
import path from 'node:path';
import { db, tx, refreshCommentCount } from './db.js';
import { ROOT, UPLOAD_DIR } from './config.js';

export function importContentIfEmpty() {
  const file = path.join(ROOT, 'content', 'bundle.json');
  if (!fs.existsSync(file) || db.prepare('SELECT COUNT(*) n FROM articles').get().n) return;
  const { articles, images, comments } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const src = path.join(ROOT, 'content', 'uploads');
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(UPLOAD_DIR, f));
  const insert = (table, row) => {
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
  };
  tx(() => {
    for (const img of images) insert('images', img);
    for (const a of articles) insert('articles', a);
    for (const c of comments) insert('comments', c);
    for (const a of articles) refreshCommentCount(a.id);
  });
  console.log(`Imported ${articles.length} articles, ${images.length} images and ${comments.length} comments from content/.`);
}
