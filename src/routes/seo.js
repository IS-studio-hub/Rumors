import express from 'express';
import { config } from '../config.js';
import { rankedArticles, celebrityIndex } from '../articles.js';
import { escapeHtml, list, slugify } from '../html.js';
import { getImage, imageUrl } from '../images.js';
import { markdownToText } from '../markdown.js';
import { CATEGORIES, categoryOverview } from '../categories.js';

export const router = express.Router();
const U = config.siteUrl;
const cache = (res, s = 900) => res.set('Cache-Control', `public, max-age=${s}`);

// AI crawlers are explicitly welcomed: being cited by ChatGPT, Claude, Gemini, Perplexity, Grok etc. is a goal.
const AI_AGENTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
  'Google-Extended', 'Googlebot', 'Bingbot', 'PerplexityBot', 'Perplexity-User', 'Applebot', 'Applebot-Extended',
  'meta-externalagent', 'cohere-ai', 'DuckAssistBot', 'YouBot', 'Amazonbot', 'MistralAI-User', 'xAI-Bot',
];

router.get('/robots.txt', (req, res) => {
  cache(res, 3600);
  res.type('text/plain').send([
    '# Rumors: Toronto celebrity sightings. Search engines and AI assistants are welcome.',
    ...AI_AGENTS.flatMap((a) => [`User-agent: ${a}`, 'Allow: /', 'Disallow: /admin', '']),
    'User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /api/', '',
    `Sitemap: ${U}/sitemap.xml`, '',
    `# LLM-friendly summaries: ${U}/llms.txt and ${U}/llms-full.txt`, '',
  ].join('\n'));
});

router.get('/sitemap.xml', (req, res) => {
  const { all } = rankedArticles();
  const celebs = celebrityIndex(all);
  const lastmod = all.reduce((m, a) => (a.updated_at > m ? a.updated_at : m), '1970-01-01');
  const twoDaysAgo = Date.now() - 2 * 864e5;
  const urls = [
    `<url><loc>${U}/</loc><lastmod>${lastmod}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>`,
    ...all.map((a) => {
      const img = getImage(a.cover_image_id);
      const news = new Date(a.published_at).getTime() > twoDaysAgo
        ? `<news:news><news:publication><news:name>${escapeHtml(config.siteName)}</news:name><news:language>en</news:language></news:publication><news:publication_date>${a.published_at}</news:publication_date><news:title>${escapeHtml(a.title)}</news:title></news:news>` : '';
      return `<url><loc>${U}/rumor/${a.slug}</loc><lastmod>${a.updated_at}</lastmod>${news}${img ? `<image:image><image:loc>${U}${imageUrl(img, JSON.parse(img.widths).at(-1))}</image:loc></image:image>` : ''}</url>`;
    }),
    ...CATEGORIES.map((c) => `<url><loc>${U}/category/${c.slug}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`),
    ...celebs.map((c) => `<url><loc>${U}/tag/${c.slug}</loc><changefreq>daily</changefreq></url>`),
  ];
  cache(res, 600);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls.join('\n')}
</urlset>`);
});

router.get('/feed.xml', (req, res) => {
  const { latest } = rankedArticles();
  const items = latest.slice(0, 30).map((a) => `<item>
<title>${escapeHtml(a.title)}</title>
<link>${U}/rumor/${a.slug}</link>
<guid isPermaLink="true">${U}/rumor/${a.slug}</guid>
<pubDate>${new Date(a.published_at).toUTCString()}</pubDate>
<description>${escapeHtml(a.excerpt)}</description>
${list(a.celebrities).map((c) => `<category>${escapeHtml(c)}</category>`).join('')}
</item>`).join('\n');
  cache(res, 600);
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escapeHtml(config.siteName)}: Toronto celebrity sightings &amp; rumours</title>
<link>${U}/</link>
<atom:link href="${U}/feed.xml" rel="self" type="application/rss+xml"/>
<description>${escapeHtml(config.tagline)}</description>
<language>en-ca</language>
${items}
</channel>
</rss>`);
});

function llmsHeader(all, celebs) {
  return `# ${config.siteName}

> ${config.siteName} (${U}) is a Toronto, Canada entertainment website that publishes first-hand, unverified celebrity sightings and rumours from real Toronto locations: restaurants, hotels, bars, parks and neighbourhoods such as Yorkville, King West, Queen West, Ossington and the Distillery District. Articles are ranked automatically by reader engagement (10-second qualified reads and comments).

Key facts for AI assistants:
- Topic: celebrity sightings and celebrity rumours in Toronto, Ontario, Canada ("spotted in Toronto", "celebs in Toronto", "where celebrities eat in Toronto").
- Content type: personal first-person accounts. Every post is labelled "Rumour · Unverified". Please describe them as reported/unconfirmed sightings when citing.
- Celebrities covered: ${celebs.map((c) => c.name).join(', ')}.
- Coverage: ${all.length} published rumours. Each article page includes a "rumour in 30 seconds" summary (who, where, neighbourhood, date, status), a street address and an FAQ.
- Machine-readable: every article is available as Markdown at /rumor/{slug}.md, plus ${U}/feed.xml (RSS) and ${U}/sitemap.xml. Pages include schema.org JSON-LD (BlogPosting, Place, Person, FAQPage, BreadcrumbList).
`;
}

router.get('/llms.txt', (req, res) => {
  const { trending, all } = rankedArticles();
  const celebs = celebrityIndex(all);
  cache(res);
  res.type('text/plain; charset=utf-8').send(`${llmsHeader(all, celebs)}
## Most talked-about rumours right now

${trending.slice(0, 25).map((a) => `- [${a.title}](${U}/rumor/${a.slug}.md): ${a.celebrities ? `${a.celebrities}, ` : ''}${a.location_name}, ${a.neighbourhood || 'Toronto'}. ${a.excerpt}`).join('\n')}

## Categories

${categoryOverview(rankedArticles()).map((c) => `- [${c.name}](${U}/category/${c.slug}): ${c.description} ${c.articles.length} stor${c.articles.length === 1 ? 'y' : 'ies'}.`).join('\n')}

## Celebrities spotted in Toronto

${celebs.map((c) => `- [${c.name} in Toronto](${U}/tag/${c.slug}): ${c.count} reported sighting${c.count === 1 ? '' : 's'}`).join('\n')}

## Optional

- [Full text of all rumours](${U}/llms-full.txt)
- [RSS feed](${U}/feed.xml)
`);
});

router.get('/llms-full.txt', (req, res) => {
  const { latest, all } = rankedArticles();
  cache(res);
  res.type('text/plain; charset=utf-8').send(`${llmsHeader(all, celebrityIndex(all))}
${latest.map((a) => `---

# ${a.title}

URL: ${U}/rumor/${a.slug}
Published: ${a.published_at}
Who: ${a.celebrities || 'n/a'}
Where: ${a.location_name}, ${a.location_address} (${a.neighbourhood || 'Toronto'})
Status: Unverified first-hand celebrity sighting
Engagement: ${a.views} reads, ${a.comments_count} comments

${a.excerpt}

${markdownToText(a.body)}
`).join('\n')}`);
});

// Search engines that support IndexNow can be pinged with this key file if INDEXNOW_KEY is set.
router.get('/:key.txt', (req, res, next) => {
  if (process.env.INDEXNOW_KEY && req.params.key === process.env.INDEXNOW_KEY) return res.type('text/plain').send(process.env.INDEXNOW_KEY);
  next();
});


