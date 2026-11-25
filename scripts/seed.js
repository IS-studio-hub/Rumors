// Seeds starter articles with generated placeholder cover art. Views and comments start at zero (real engagement only).
// Safe to re-run: skips slugs that exist.
// Usage: npm run seed
process.env.TZ = 'America/Toronto';
import sharp from 'sharp';
import { db } from '../src/db.js';
import { createImage } from '../src/images.js';
import { slugify } from '../src/html.js';
import { ARTICLES } from './articles-data.js';

const REFRESH = process.argv.includes('--refresh'); // rewrite text of existing starter articles

const PALETTES = [
  ['#1b0a12', '#c8104a'], ['#0b1424', '#2f6fd6'], ['#14100a', '#d68a1a'], ['#0d1a14', '#1f9d6b'],
  ['#170b22', '#8b3fd6'], ['#1a0e0a', '#e0532c'], ['#0a1a1d', '#14a3b8'], ['#1d0b18', '#d63fa4'],
];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function coverArt(place, hood, i) {
  const [a, b] = PALETTES[i % PALETTES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
  <defs><radialGradient id="g" cx="78%" cy="22%" r="95%"><stop offset="0" stop-color="${b}"/><stop offset=".62" stop-color="${a}"/></radialGradient>
  <pattern id="d" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#fff" fill-opacity=".08"/></pattern></defs>
  <rect width="1600" height="1000" fill="url(#g)"/><rect width="1600" height="1000" fill="url(#d)"/>
  <g fill="#000" fill-opacity=".35">
    <rect x="80" y="610" width="120" height="390"/><rect x="220" y="540" width="90" height="460"/><rect x="330" y="660" width="150" height="340"/>
    <rect x="1080" y="560" width="110" height="440"/><rect x="1210" y="470" width="80" height="530"/><rect x="1310" y="620" width="160" height="380"/>
    <rect x="745" y="300" width="16" height="700"/><ellipse cx="753" cy="470" rx="34" ry="22"/><rect x="749" y="150" width="8" height="160"/>
  </g>
  <text x="110" y="200" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="700" letter-spacing="8" fill="#fff" fill-opacity=".85">SPOTTED · ${esc(hood.toUpperCase())}</text>
  <text x="104" y="310" font-family="Georgia, serif" font-size="110" font-weight="700" fill="#fff">${esc(place)}</text>
  <text x="1500" y="940" text-anchor="end" font-family="Georgia, serif" font-size="56" font-weight="700" fill="#fff" fill-opacity=".9">Rumors<tspan fill="${b}">.</tspan></text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const hoursAgo = (h) => new Date(Date.now() - h * 36e5).toISOString();

const exists = db.prepare('SELECT id FROM articles WHERE slug = ?');
const insert = db.prepare(`INSERT INTO articles (slug, title, excerpt, body, cover_image_id, location_name, location_address, neighbourhood,
  celebrities, tags, faq, meta_title, meta_description, author_name, status, featured, views, published_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

let created = 0;
let refreshed = 0;
for (const [i, a] of ARTICLES.entries()) {
  const slug = slugify(`${a.celebrities.split(',')[0]} spotted ${a.location_name} toronto`);
  const existing = exists.get(slug);
  if (existing) {
    if (REFRESH) {
      db.prepare(`UPDATE articles SET title=?, excerpt=?, body=?, faq=?, author_name=?,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(a.title, a.excerpt, a.body, a.faq, a.author, existing.id);
      refreshed++;
    }
    continue;
  }
  const img = await createImage(await coverArt(a.location_name, a.neighbourhood, i), {
    originalName: `${slug}.png`,
    alt: `Illustrated cover: ${a.location_name}, ${a.neighbourhood}, Toronto`,
  });
  const published = hoursAgo(a.hours);
  insert.run(slug, a.title, a.excerpt, a.body, img.id, a.location_name, a.location_address, a.neighbourhood,
    a.celebrities, a.tags, a.faq, '', '', a.author, 'published', a.featured || 0, 0, published, published);
  created++;
}
console.log(`Seeded ${created} new article(s)${REFRESH ? `, refreshed ${refreshed}` : ''}.`);
