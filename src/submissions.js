// Storage for reader-submitted rumours. Uploaded files are private: they are stored outside
// the public folder and only served to a signed-in admin.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { db } from './db.js';
import { DATA_DIR } from './config.js';

export const SUB_DIR = path.join(DATA_DIR, 'submissions');
fs.mkdirSync(SUB_DIR, { recursive: true });

const rand = () => crypto.randomBytes(12).toString('hex');

/** Identify audio by its first bytes; the browser-supplied type is never trusted. */
function sniffAudio(buf) {
  const ascii = (a, b) => buf.subarray(a, b).toString('latin1');
  if (buf.length < 12) return null;
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { ext: 'webm', mime: 'audio/webm' };
  if (ascii(0, 4) === 'OggS') return { ext: 'ogg', mime: 'audio/ogg' };
  if (ascii(4, 8) === 'ftyp') return { ext: 'm4a', mime: 'audio/mp4' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { ext: 'wav', mime: 'audio/wav' };
  if (ascii(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { ext: 'mp3', mime: 'audio/mpeg' };
  return null;
}

export function saveAudio(buffer) {
  const kind = sniffAudio(buffer);
  if (!kind) throw new Error('That recording is not a supported audio file.');
  const file = `${rand()}.${kind.ext}`;
  fs.writeFileSync(path.join(SUB_DIR, file), buffer, { mode: 0o600 });
  return { file, mime: kind.mime };
}

/** Re-encode to WebP: proves it is an image and strips EXIF/GPS location data. */
export async function savePhoto(buffer) {
  const file = `${rand()}.webp`;
  await sharp(buffer, { failOn: 'error', limitInputPixels: 60_000_000 }).rotate()
    .resize({ width: 2000, withoutEnlargement: true }).webp({ quality: 85 })
    .toFile(path.join(SUB_DIR, file));
  return file;
}

export const filePath = (file) => (file && /^[a-f0-9]{24}\.(webm|ogg|m4a|wav|mp3|webp)$/.test(file) ? path.join(SUB_DIR, file) : null);

export function deleteSubmission(id) {
  const s = db.prepare('SELECT photo_file, audio_file FROM submissions WHERE id = ?').get(id);
  if (!s) return;
  for (const f of [s.photo_file, s.audio_file]) { const p = filePath(f); if (p) fs.rm(p, { force: true }, () => {}); }
  db.prepare('DELETE FROM submissions WHERE id = ?').run(id);
}

export const pendingCount = () => db.prepare("SELECT COUNT(*) n FROM submissions WHERE status = 'pending'").get().n;
