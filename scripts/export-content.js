// Usage: npm run export-content
// Writes the PUBLISHED articles, the images they use and their visible comments to content/,
// so a fresh server (e.g. Railway) starts with the same site. Drafts, reader tips, web radar
// finds, users and sessions are never exported.
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db.js';
import { ROOT, UPLOAD_DIR } from '../src/config.js';

const OUT = path.join(ROOT, 'content');
const OUT_UP = path.join(OUT, 'uploads');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT_UP, { recursive: true });

const articles = db.prepare("SELECT * FROM articles WHERE status = 'published' ORDER BY id").all();
const imageIds = new Set();
for (const a of articles) {
  if (a.cover_image_id) imageIds.add(a.cover_image_id);
  for (const m of a.body.matchAll(/\(image:(\d+)\)/g)) imageIds.add(Number(m[1]));
}
const images = [...imageIds].map((id) => db.prepare('SELECT * FROM images WHERE id = ?').get(id)).filter(Boolean);
for (const img of images) {
  for (const w of JSON.parse(img.widths)) {
    const f = `${img.base}-v${img.version}-${w}.webp`;
    fs.copyFileSync(path.join(UPLOAD_DIR, f), path.join(OUT_UP, f));
  }
}
const ids = articles.map((a) => a.id);
const comments = db.prepare(`SELECT id, article_id, name, body, status, visitor, created_at FROM comments
  WHERE status = 'visible' AND article_id IN (${ids.map(() => '?').join(',') || 'NULL'}) ORDER BY id`).all(...ids)
  // Real readers' visitor ids are private hashes: keep only the "sample" marker.
  .map((c) => ({ ...c, visitor: c.visitor === 'sample' ? 'sample' : null }));
// Counts restart from zero on the new server, except comments, which come along.
const clean = articles.map((a) => ({ ...a, views: 0 }));

fs.writeFileSync(path.join(OUT, 'bundle.json'), JSON.stringify({ exported_at: new Date().toISOString(), articles: clean, images, comments }, null, 1));
console.log(`Exported ${articles.length} articles, ${images.length} images, ${comments.length} comments to content/.`);
