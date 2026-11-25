import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT } from './config.js';

const PUB = path.join(ROOT, 'public');

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111"/><text x="32" y="46" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="42" font-weight="700" fill="#fff">R</text><circle cx="50" cy="44" r="5" fill="#ff2e63"/></svg>`;

const OG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#111"/><stop offset="1" stop-color="#2a0a16"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/>
<text x="90" y="330" font-family="Georgia, 'Times New Roman', serif" font-size="190" font-weight="700" fill="#fff">Rumors<tspan fill="#ff2e63">.</tspan></text>
<text x="96" y="420" font-family="Helvetica, Arial, sans-serif" font-size="40" fill="#e6e6e6">Toronto celebrity sightings &amp; rumours</text>
</svg>`;

export async function ensureBrandAssets() {
  const fav = path.join(PUB, 'favicon.svg');
  if (!fs.existsSync(fav)) fs.writeFileSync(fav, ICON);
  const icon = path.join(PUB, 'icon-512.png');
  if (!fs.existsSync(icon)) await sharp(Buffer.from(ICON)).resize(512, 512).png().toFile(icon);
  const og = path.join(PUB, 'og-default.png');
  if (!fs.existsSync(og)) await sharp(Buffer.from(OG)).png({ compressionLevel: 9 }).toFile(og);
  const ico = path.join(PUB, 'favicon.ico');
  if (!fs.existsSync(ico)) await sharp(Buffer.from(ICON)).resize(32, 32).png().toFile(ico); // PNG-in-ICO is accepted by browsers
}
