import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { html, jsonLd, raw } from '../html.js';
import { config, ROOT } from '../config.js';
import { CATEGORIES } from '../categories.js';

// Fingerprint static assets so they can be cached forever.
const versions = {};
export function asset(p) {
  if (!versions[p] || !config.isProd) {
    const file = path.join(ROOT, 'public', p);
    versions[p] = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
  }
  return `${p}?v=${versions[p]}`;
}

export const abs = (p) => (p && /^https?:/.test(p) ? p : `${config.siteUrl}${p || '/'}`);

export const organization = () => ({
  '@type': 'NewsMediaOrganization',
  '@id': `${config.siteUrl}/#org`,
  name: config.siteName,
  url: `${config.siteUrl}/`,
  logo: { '@type': 'ImageObject', url: abs('/icon-512.png'), width: 512, height: 512 },
  description: 'Rumors is a Toronto entertainment site publishing first-hand, unverified celebrity sightings and rumours from real Toronto restaurants, hotels, bars and neighbourhoods.',
  areaServed: { '@type': 'City', name: 'Toronto', containedInPlace: { '@type': 'AdministrativeArea', name: 'Ontario, Canada' } },
  knowsAbout: ['Toronto celebrity sightings', 'Canadian celebrities', 'Celebrity rumours', 'TIFF', 'Toronto restaurants', 'Yorkville'],
});

/**
 * @param {object} o
 * @param {string} o.title       <title>
 * @param {string} o.description meta description
 * @param {string} o.path        canonical path
 * @param {object} [o.image]     { url, width, height, alt }
 * @param {string} [o.type]      og:type
 * @param {Array}  [o.schema]    JSON-LD nodes (merged into one @graph)
 * @param {string} [o.robots]
 * @param {*}      o.body
 * @param {*}      [o.head]      extra head tags
 */
export function layout(res, o) {
  const canonical = abs(o.path);
  const graph = [
    organization(),
    { '@type': 'WebSite', '@id': `${config.siteUrl}/#website`, url: `${config.siteUrl}/`, name: config.siteName,
      alternateName: ['Rumors Toronto', 'Toronto Rumors'], description: config.tagline, inLanguage: 'en-CA',
      publisher: { '@id': `${config.siteUrl}/#org` } },
    ...(o.schema || []),
  ];
  const img = o.image || { url: abs('/og-default.png'), width: 1200, height: 630, alt: `${config.siteName}: ${config.tagline}` };
  return html`<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title}</title>
<meta name="description" content="${o.description}">
<meta name="robots" content="${o.robots || 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'}">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#111111">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon-512.png">
<link rel="stylesheet" href="${asset('/css/site.css')}">
<link rel="alternate" type="application/rss+xml" title="${config.siteName}: latest Toronto rumours" href="/feed.xml">
<link rel="alternate" type="text/plain" title="LLM summary" href="/llms.txt">
<meta property="og:site_name" content="${config.siteName}">
<meta property="og:locale" content="${config.locale}">
<meta property="og:type" content="${o.type || 'website'}">
<meta property="og:title" content="${o.ogTitle || o.title}">
<meta property="og:description" content="${o.description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${abs(img.url)}">
<meta property="og:image:width" content="${img.width}">
<meta property="og:image:height" content="${img.height}">
<meta property="og:image:alt" content="${img.alt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${o.ogTitle || o.title}">
<meta name="twitter:description" content="${o.description}">
<meta name="twitter:image" content="${abs(img.url)}">
${o.head || ''}
<script type="application/ld+json" nonce="${res.locals.nonce}">${jsonLd({ '@context': 'https://schema.org', '@graph': graph })}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/" aria-label="${config.siteName} home">Rumors<span class="brand-dot" aria-hidden="true">.</span></a>
    <p class="brand-tag">Toronto celeb sightings &amp; rumours</p>
    <a class="btn-tip" href="/send-a-rumor">Send us a rumor</a>
  </div>
  <nav class="cat-nav" aria-label="Categories">
    <ul class="wrap">${CATEGORIES.map((c) => html`<li><a href="/category/${c.slug}" ${o.path === `/category/${c.slug}` ? html`aria-current="page"` : ''}>${c.name}</a></li>`)}</ul>
  </nav>
</header>
<main id="main" tabindex="-1">
${o.body}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <div>
      <p class="brand brand-sm">Rumors<span class="brand-dot" aria-hidden="true">.</span></p>
      <p><strong>Rumors</strong> publishes first-hand celebrity sightings and rumours from real places around Toronto, Ontario, from Yorkville patios and King West dining rooms to Queen West bars and the Distillery District.</p>
      <p class="fine">Everything here is a personal, <strong>unverified</strong> account shared for entertainment. Sightings are not confirmed by the people named, their representatives, or the venues. Spotted someone? Tell us in the comments.</p>
    </div>
    <nav aria-label="Footer">
      <ul class="footer-links">
        <li><a href="/">Latest rumours</a></li>
        <li><a href="/feed.xml">RSS feed</a></li>
        <li><a href="/sitemap.xml">Sitemap</a></li>
        <li><a href="/llms.txt">For AI assistants</a></li>
      </ul>
    </nav>
  </div>
  <p class="wrap fine">© ${new Date().getFullYear()} ${config.siteName}. Toronto, Canada.</p>
</footer>
${o.scripts || ''}
</body>
</html>`;
}

export const send = (res, page, status = 200) => res.status(status).type('html').send(String(page));
export { raw };
