// Finds a cover photo that is free to reuse (CC0, CC BY, CC BY-SA or public domain) on
// Wikimedia Commons, so the site doesn't copy copyrighted press photos. The credit line the
// licence requires is returned with the image.
import sharp from 'sharp';

const UA = 'RumorsCMS/1.0 (self-hosted news site; image lookup)';
const FREE = /^(cc0|cc[ -]by(-sa)?([ -]\d\.\d)?|public domain|pd\b|pdm)/i;

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const INFO = 'prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=1600&format=json&formatversion=2&origin=*';

function usable(page) {
  const ii = page?.imageinfo?.[0];
  if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime) || ii.width < 700) return null;
  const meta = ii.extmetadata || {};
  const license = strip(meta.LicenseShortName?.value);
  if (!FREE.test(license) || /non-?free|fair use/i.test(`${license} ${strip(meta.UsageTerms?.value)}`)) return null;
  const artist = strip(meta.Artist?.value).slice(0, 80) || 'Unknown photographer';
  return { url: ii.thumburl || ii.url, fileName: page.title.replace(/^File:/, ''), credit: `Photo: ${artist} / ${license} via Wikimedia Commons`.slice(0, 200), width: ii.width, height: ii.height };
}

/** The lead photo of the person's English Wikipedia article, if it is freely licensed. */
async function wikipediaPortrait(name) {
  const q = await getJson(`https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=name&redirects=1&format=json&formatversion=2&origin=*&titles=${encodeURIComponent(name)}`);
  const file = q?.query?.pages?.[0]?.pageimage;
  if (!file) return null;
  const c = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(`File:${file}`)}&${INFO}`);
  return usable(c?.query?.pages?.[0]); // missing on Commons = a local "fair use" file, which we skip
}

async function commonsSearch(query) {
  const c = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap`)}&${INFO}`);
  const pages = (c?.query?.pages || []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const hits = pages.map(usable).filter(Boolean);
  return hits.find((h) => h.width >= h.height) || hits[0] || null; // prefer landscape
}

async function download(hit) {
  const res = await fetch(hit.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 20 * 1024 * 1024) throw new Error('Image too large');
  // Tall portraits make awkward covers: crop to 4:3 around the most interesting area (usually the face).
  const meta = await sharp(buf).metadata();
  if (meta.width && meta.height && meta.height > meta.width * 0.9) {
    return sharp(buf).rotate().resize({ width: meta.width, height: Math.round(meta.width * 0.75), fit: 'cover', position: sharp.strategy.attention }).jpeg({ quality: 90 }).toBuffer();
  }
  return buf;
}

/** Try the celebrity first, then the venue, then the neighbourhood. Returns null if nothing free fits. */
export async function findCoverImage({ celebrities = [], place = '', neighbourhood = '' }) {
  const attempts = [];
  for (const name of celebrities.slice(0, 2)) {
    attempts.push({ subject: name, isPerson: true, run: () => wikipediaPortrait(name) });
    attempts.push({ subject: name, isPerson: true, run: () => commonsSearch(`"${name}"`) });
  }
  if (place) attempts.push({ subject: place, isPerson: false, run: () => commonsSearch(`"${place}" Toronto`) });
  if (neighbourhood) attempts.push({ subject: neighbourhood, isPerson: false, run: () => commonsSearch(`${neighbourhood} Toronto`) });
  for (const a of attempts) {
    try {
      const hit = await a.run();
      if (hit) return { ...hit, buffer: await download(hit), subject: a.subject, isPerson: a.isPerson };
    } catch (e) { console.warn(`Image lookup (${a.subject}):`, e.message); }
  }
  return null;
}
