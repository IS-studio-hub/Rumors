import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { db } from './db.js';
import { UPLOAD_DIR } from './config.js';
import { html } from './html.js';

const WIDTHS = [480, 960, 1600];
sharp.cache(false);

const fileName = (base, version, w) => `${base}-v${version}-${w}.webp`;
export const imageUrl = (img, w) => `/uploads/${fileName(img.base, img.version, w)}`;

/** Decode, auto-rotate, strip metadata (EXIF/GPS) and write responsive WebP renditions. */
async function writeRenditions(buffer, base, version) {
  const input = sharp(buffer, { failOn: 'error', limitInputPixels: 60_000_000 }).rotate();
  const meta = await input.metadata();
  if (!meta.width || !meta.height) throw new Error('Not a valid image');
  // Account for EXIF orientation swap.
  const swap = (meta.orientation || 1) >= 5;
  const srcW = swap ? meta.height : meta.width;
  const srcH = swap ? meta.width : meta.height;
  const widths = WIDTHS.filter((w) => w < srcW);
  widths.push(Math.min(srcW, 1600));
  const unique = [...new Set(widths)].sort((a, b) => a - b);
  for (const w of unique) {
    await sharp(buffer, { limitInputPixels: 60_000_000 }).rotate().resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 }).toFile(path.join(UPLOAD_DIR, fileName(base, version, w)));
  }
  const maxW = unique[unique.length - 1];
  return { width: maxW, height: Math.round((srcH / srcW) * maxW), widths: unique };
}

function removeFiles(img) {
  for (const w of JSON.parse(img.widths)) {
    fs.rm(path.join(UPLOAD_DIR, fileName(img.base, img.version, w)), { force: true }, () => {});
  }
}

export async function createImage(buffer, { originalName = '', alt = '', credit = '' } = {}) {
  const base = crypto.randomBytes(9).toString('base64url').replace(/[^a-zA-Z0-9]/g, 'x');
  const r = await writeRenditions(buffer, base, 1);
  const info = db.prepare(`INSERT INTO images (base, version, original_name, alt, credit, width, height, widths)
    VALUES (?,?,?,?,?,?,?,?)`).run(base, 1, originalName.slice(0, 200), alt.slice(0, 300), credit.slice(0, 200), r.width, r.height, JSON.stringify(r.widths));
  return getImage(Number(info.lastInsertRowid));
}

/** Replace the pixels of an existing image. Every article using it updates automatically. */
export async function replaceImage(id, buffer, originalName = '') {
  const img = getImage(id);
  if (!img) throw new Error('Image not found');
  const version = img.version + 1;
  const r = await writeRenditions(buffer, img.base, version);
  db.prepare(`UPDATE images SET version=?, width=?, height=?, widths=?, original_name=?,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
    .run(version, r.width, r.height, JSON.stringify(r.widths), originalName.slice(0, 200) || img.original_name, id);
  removeFiles(img);
  return getImage(id);
}

export function deleteImage(id) {
  const img = getImage(id);
  if (!img) return;
  db.prepare('DELETE FROM images WHERE id = ?').run(id);
  removeFiles(img);
}

export const getImage = (id) => (id ? db.prepare('SELECT * FROM images WHERE id = ?').get(Number(id)) : null);

export function imageUsage(id) {
  return db.prepare(`SELECT id, title FROM articles WHERE cover_image_id = ? OR body LIKE ?`).all(id, `%(image:${id}%`);
}

export function srcset(img) {
  return JSON.parse(img.widths).map((w) => `${imageUrl(img, w)} ${w}w`).join(', ');
}

/** Responsive <img>. `eager` for above-the-fold (LCP) images. */
export function picture(img, { sizes = '(max-width: 760px) 100vw, 760px', eager = false, alt, className = '' } = {}) {
  if (!img) return '';
  const widths = JSON.parse(img.widths);
  const mid = widths.find((w) => w >= 960) || widths[widths.length - 1];
  return html`<img class="${className}" src="${imageUrl(img, mid)}" srcset="${srcset(img)}" sizes="${sizes}"
    width="${img.width}" height="${img.height}" alt="${alt ?? img.alt}" ${eager ? html`fetchpriority="high"` : html`loading="lazy"`} decoding="async">`;
}

export function publicImage(img) {
  if (!img) return null;
  return { id: img.id, alt: img.alt, credit: img.credit, width: img.width, height: img.height,
    url: imageUrl(img, JSON.parse(img.widths).at(-1)), thumb: imageUrl(img, JSON.parse(img.widths)[0]),
    original_name: img.original_name, updated_at: img.updated_at };
}
