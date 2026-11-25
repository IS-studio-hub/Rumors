import { html, raw, list, slugify, formatDate, timeAgo, readingMinutes } from '../html.js';
import { layout, abs, asset } from './layout.js';
import { config } from '../config.js';
import { getImage, picture, imageUrl } from '../images.js';
import { renderMarkdown, parseFaq, markdownToText } from '../markdown.js';
import { CATEGORIES, categoryOverview, categoriesOf, trendingTop, bySlug } from '../categories.js';

const n = (x) => new Intl.NumberFormat('en-CA', { notation: x >= 10000 ? 'compact' : 'standard' }).format(x);
const plural = (x, w) => `${n(x)} ${w}${x === 1 ? '' : 's'}`;

function stats(a) {
  return html`<span class="stat"><span class="visually-hidden">Views:</span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z"/></svg>${plural(a.views, 'read')}</span>
  <span class="stat"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h16v12H7l-3 3V4Z"/></svg>${plural(a.comments_count, 'comment')}</span>`;
}

function celebChips(a, max = 3) {
  const names = list(a.celebrities).slice(0, max);
  if (!names.length) return '';
  return html`<ul class="chips" aria-label="Celebrities mentioned">${names.map((c) => html`<li><a class="chip" href="/tag/${slugify(c)}">${c}</a></li>`)}</ul>`;
}

function card(a, { size = 'md', eager = false, headingLevel = 3 } = {}) {
  const img = getImage(a.cover_image_id);
  const h = `h${headingLevel}`;
  return html`<article class="card card-${size}">
    ${img ? html`<a class="card-media" href="/rumor/${a.slug}" tabindex="-1" aria-hidden="true">${picture(img, {
      sizes: size === 'lg' ? '(max-width: 900px) 100vw, 860px' : '(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 380px',
      eager, alt: '' })}</a>` : ''}
    <div class="card-body">
      <p class="kicker"><span class="pin" aria-hidden="true">●</span> ${a.location_name}${a.neighbourhood ? html` · ${a.neighbourhood}` : ''}</p>
      ${raw(`<${h} class="card-title">`)}<a href="/rumor/${a.slug}">${a.title}</a>${raw(`</${h}>`)}
      ${size !== 'sm' ? html`<p class="card-excerpt">${a.excerpt}</p>` : ''}
      <p class="meta"><time datetime="${a.published_at}">${timeAgo(a.published_at)}</time> ${stats(a)}</p>
      ${size !== 'sm' ? celebChips(a) : ''}
    </div>
  </article>`;
}

function itemList(articles, name) {
  return {
    '@type': 'ItemList', name,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    numberOfItems: articles.length,
    itemListElement: articles.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(`/rumor/${a.slug}`), name: a.title })),
  };
}

export function homePage(res, { ranked, celebs, page, pageCount, latestPage }) {
  const [hero, ...rest] = ranked.trending;
  const trending = rest.slice(0, 5);
  const discussed = ranked.discussed.slice(0, 5);
  const isFirst = page === 1;
  const title = isFirst
    ? 'Rumors | Toronto Celebrity Sightings, Celeb Rumours & Spotted in Toronto'
    : `Latest Toronto Celebrity Rumours, Page ${page} | Rumors`;
  const names = celebs.slice(0, 5).map((c) => c.name).join(', ');
  const description = `First-hand Toronto celebrity sightings and rumours${names ? `: ${names} and more` : ''} spotted at real Toronto restaurants, hotels and bars. Ranked by what readers are talking about.`;

  const body = html`
  <h1 class="visually-hidden">Rumors: Toronto celebrity sightings and rumours</h1>
  ${isFirst && hero ? html`
  <section class="wrap hero-grid" aria-labelledby="top-story">
    <div class="hero-main">
      <p class="section-label"><span class="flame" aria-hidden="true"></span><span id="top-story">#1 most talked-about right now</span></p>
      ${card(hero, { size: 'lg', eager: true, headingLevel: 2 })}
    </div>
    <aside class="trending" aria-labelledby="trending-h">
      <h2 id="trending-h" class="section-title">Trending now</h2>
      <ol class="rank-list">
        ${trending.map((a) => html`<li>
          <span class="rank" aria-hidden="true">${a.rank}</span>
          <div>
            <a class="rank-title" href="/rumor/${a.slug}">${a.title}</a>
            <p class="meta">${a.location_name} · ${stats(a)}</p>
          </div>
        </li>`)}
      </ol>
      <p class="how-ranked">Ranked automatically by reader engagement: reads (10+ seconds on the page) and comments, weighted toward fresh rumours.</p>
    </aside>
  </section>` : ''}

  ${isFirst ? categorySection(ranked) : ''}

  ${isFirst && celebs.length ? html`
  <section class="wrap spotted" aria-labelledby="spotted-h">
    <h2 id="spotted-h" class="section-title">Who’s been spotted in Toronto</h2>
    <ul class="chips chips-lg">${celebs.slice(0, 18).map((c) => html`<li><a class="chip" href="/tag/${c.slug}">${c.name} <span class="chip-count">${c.count}</span></a></li>`)}</ul>
  </section>` : ''}

  <section class="wrap" aria-labelledby="latest-h">
    <h2 id="latest-h" class="section-title">${isFirst ? 'Latest rumours' : `Latest rumours, page ${page}`}</h2>
    <div class="grid">${latestPage.map((a) => card(a))}</div>
    ${pager(page, pageCount, '/')}
  </section>

  ${isFirst && discussed.length ? html`
  <section class="wrap" aria-labelledby="discussed-h">
    <h2 id="discussed-h" class="section-title">Most discussed</h2>
    <div class="grid grid-sm">${discussed.map((a) => card(a, { size: 'sm' }))}</div>
  </section>` : ''}

  ${isFirst ? html`<section class="wrap about-box" aria-labelledby="about-h">
    <h2 id="about-h">What is Rumors?</h2>
    <p><strong>Rumors</strong> is a Toronto celebrity-sighting site. Each post is a first-person account from someone who was there (a Yorkville restaurant during TIFF, a King West patio, a Queen West bar or a Leslieville brunch spot), describing which Canadian or international celebrity they believe they saw, what happened, and where it was. Posts are unverified rumours, written for entertainment, and ranked by how much Toronto is reading and talking about them.</p>
  </section>` : ''}`;

  return layout(res, {
    title, description, path: page > 1 ? `/?page=${page}` : '/',
    schema: [
      { '@type': 'CollectionPage', '@id': `${abs('/')}#page`, url: abs('/'), name: title, description,
        isPartOf: { '@id': `${config.siteUrl}/#website` }, about: { '@type': 'Thing', name: 'Toronto celebrity sightings' },
        mainEntity: itemList(ranked.trending.slice(0, 10), 'Trending Toronto celebrity rumours') },
    ],
    head: html`${page < pageCount ? html`<link rel="next" href="/?page=${page + 1}">` : ''}${page > 1 ? html`<link rel="prev" href="${page === 2 ? '/' : `/?page=${page - 1}`}">` : ''}`,
    body,
  });
}

function pager(page, count, base) {
  if (count <= 1) return '';
  const href = (p) => (p === 1 ? base : `${base}?page=${p}`);
  return html`<nav class="pager" aria-label="Pagination">
    ${page > 1 ? html`<a href="${href(page - 1)}" rel="prev">← Newer</a>` : html`<span></span>`}
    <span>Page ${page} of ${count}</span>
    ${page < count ? html`<a href="${href(page + 1)}" rel="next">Older →</a>` : html`<span></span>`}
  </nav>`;
}

export function tagPage(res, { label, slug, articles, isCeleb }) {
  const title = isCeleb
    ? `${label} Spotted in Toronto: ${label} Sightings & Rumours | Rumors`
    : `${label}: Toronto Celebrity Sightings & Rumours | Rumors`;
  const description = isCeleb
    ? `Every ${label} sighting and rumour in Toronto reported by Rumors readers: where ${label} was spotted, what happened, and what people are saying. ${articles.length} ${articles.length === 1 ? 'story' : 'stories'}.`
    : `Celebrity sightings and rumours tagged “${label}” in Toronto, ranked by reader engagement.`;
  return layout(res, {
    title, description, path: `/tag/${slug}`,
    schema: [
      { '@type': 'CollectionPage', url: abs(`/tag/${slug}`), name: title, description,
        isPartOf: { '@id': `${config.siteUrl}/#website` },
        about: isCeleb ? { '@type': 'Person', name: label } : { '@type': 'Thing', name: label },
        mainEntity: itemList(articles, title) },
      breadcrumbs([{ name: 'Rumors', path: '/' }, { name: label, path: `/tag/${slug}` }]),
    ],
    body: html`<div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page">${label}</li></ol></nav>
      <header class="tag-head">
        <p class="section-label">${isCeleb ? 'Celebrity' : 'Topic'}</p>
        <h1>${isCeleb ? `${label} spotted in Toronto` : label}</h1>
        <p class="lede">${isCeleb
          ? `All the ${label} sightings and rumours Rumors readers have shared from around Toronto, ranked by what people are reading and talking about most.`
          : description}</p>
      </header>
      <div class="grid">${articles.map((a, i) => card(a, { eager: i === 0, headingLevel: 2 }))}</div>
    </div>`,
  });
}

function breadcrumbs(items) {
  return { '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.path) })) };
}

export function articlePage(res, { a, comments, related, viewToken, commentToken, notice, form = {}, trendingIds: extraTrendingIds }) {
  const img = getImage(a.cover_image_id);
  const celebs = list(a.celebrities);
  const tags = list(a.tags);
  const faq = parseFaq(a.faq);
  const cats = categoriesOf(a, new Set((extraTrendingIds || []))).map(bySlug);
  const realComments = comments.filter((c) => !c.sample).length;
  const url = abs(`/rumor/${a.slug}`);
  const text = markdownToText(a.body);
  const words = text.split(/\s+/).length;
  const description = a.meta_description || a.excerpt;
  const ogImg = img ? { url: imageUrl(img, JSON.parse(img.widths).at(-1)), width: img.width, height: img.height, alt: img.alt } : null;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.location_name}, ${a.location_address || 'Toronto, ON'}`)}`;

  const place = a.location_name ? {
    '@type': 'Place', name: a.location_name,
    address: { '@type': 'PostalAddress', streetAddress: a.location_address.split(',')[0] || undefined, addressLocality: 'Toronto', addressRegion: 'ON', addressCountry: 'CA' },
    ...(a.neighbourhood ? { containedInPlace: { '@type': 'Place', name: `${a.neighbourhood}, Toronto` } } : {}),
  } : null;

  const schema = [
    {
      '@type': 'BlogPosting', '@id': `${url}#article`,
      headline: a.title.slice(0, 110), description, url, mainEntityOfPage: url,
      datePublished: a.published_at, dateModified: a.updated_at,
      author: { '@type': 'Person', name: a.author_name, url: abs('/') },
      publisher: { '@id': `${config.siteUrl}/#org` },
      isPartOf: { '@id': `${config.siteUrl}/#website` },
      inLanguage: 'en-CA', wordCount: words, articleSection: cats.length ? cats.map((c) => c.name) : 'Celebrity Sightings',
      genre: 'Entertainment rumour (unverified first-hand account)',
      keywords: [...celebs, ...tags, a.location_name, a.neighbourhood, 'Toronto', 'celebrity sighting', 'rumors'].filter(Boolean).join(', '),
      ...(ogImg ? { image: { '@type': 'ImageObject', url: abs(ogImg.url), width: ogImg.width, height: ogImg.height } } : {}),
      about: celebs.map((c) => ({ '@type': 'Person', name: c })),
      mentions: place ? [place] : undefined,
      contentLocation: place || undefined,
      locationCreated: place || undefined,
      commentCount: realComments,
      interactionStatistic: [
        { '@type': 'InteractionCounter', interactionType: 'https://schema.org/ReadAction', userInteractionCount: a.views },
        { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: realComments },
      ],
      // Sample (test) comments are never presented to search engines as real reader comments.
      comment: comments.filter((c) => !c.sample).slice(0, 10).map((c) => ({ '@type': 'Comment', text: c.body, dateCreated: c.created_at, author: { '@type': 'Person', name: c.name } })),
      speakable: { '@type': 'SpeakableSpecification', cssSelector: ['.article-title', '.tldr'] },
    },
    breadcrumbs([{ name: 'Rumors', path: '/' }, ...(celebs[0] ? [{ name: celebs[0], path: `/tag/${slugify(celebs[0])}` }] : []), { name: a.title, path: `/rumor/${a.slug}` }]),
    ...(faq.length ? [{ '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }] : []),
  ];

  const body = html`<article class="wrap article" data-view-token="${viewToken}">
    <nav class="crumbs" aria-label="Breadcrumb"><ol>
      <li><a href="/">Home</a></li>
      ${celebs[0] ? html`<li><a href="/tag/${slugify(celebs[0])}">${celebs[0]}</a></li>` : ''}
      <li aria-current="page">${a.location_name || 'Rumour'}</li>
    </ol></nav>

    <header class="article-head">
      <p class="kicker"><span class="pin" aria-hidden="true">●</span> ${a.location_name}${a.neighbourhood ? html` · ${a.neighbourhood}` : ''}, Toronto</p>
      <h1 class="article-title">${a.title}</h1>
      <p class="lede">${a.excerpt}</p>
      <p class="byline">By <span>${a.author_name}</span> · <time datetime="${a.published_at}">${formatDate(a.published_at)}</time> · ${readingMinutes(text)} min read</p>
      <p class="meta">${stats(a)}</p>
    </header>

    ${img ? html`<figure class="article-cover">${picture(img, { eager: true, sizes: '(max-width: 900px) 100vw, 860px' })}${img.credit ? html`<figcaption>${img.credit}</figcaption>` : ''}</figure>` : ''}

    <aside class="tldr" aria-label="Quick facts">
      <h2>The rumour in 30 seconds</h2>
      <dl>
        ${celebs.length ? html`<div><dt>Who</dt><dd>${celebs.join(', ')}</dd></div>` : ''}
        <div><dt>Where</dt><dd>${a.location_name}${a.location_address ? html`, ${a.location_address}` : ''} (<a href="${mapUrl}" rel="noopener nofollow" target="_blank">map<span class="visually-hidden"> (opens Google Maps in a new tab)</span></a>)</dd></div>
        ${a.neighbourhood ? html`<div><dt>Neighbourhood</dt><dd>${a.neighbourhood}, Toronto</dd></div>` : ''}
        <div><dt>Reported</dt><dd>${formatDate(a.published_at)}</dd></div>
      </dl>
      <p>${a.excerpt}</p>
    </aside>

    <div class="prose">${raw(renderMarkdown(a.body))}</div>

    ${faq.length ? html`<section class="faq" aria-labelledby="faq-h">
      <h2 id="faq-h">Quick questions</h2>
      ${faq.map((f) => html`<details><summary>${f.q}</summary><p>${f.a}</p></details>`)}
    </section>` : ''}

    ${cats.length ? html`<p class="filed">Filed under ${cats.map((c, i) => html`${i ? ', ' : ''}<a href="/category/${c.slug}">${c.name}</a>`)}</p>` : ''}
    ${celebs.length || tags.length ? html`<section aria-label="Tags" class="tag-row">
      <ul class="chips">${[...celebs, ...tags].map((t) => html`<li><a class="chip" href="/tag/${slugify(t)}">${t}</a></li>`)}</ul>
    </section>` : ''}

    <p class="disclaimer">This is a personal, unverified account shared for entertainment. It has not been confirmed by ${celebs.length ? celebs.join(', ') : 'the people mentioned'}, their representatives, or ${a.location_name || 'the venue'}.</p>

    <section class="comments" id="comments" aria-labelledby="comments-h">
      <h2 id="comments-h">${plural(a.comments_count, 'comment')}</h2>
      <p class="hint">Were you there? Saw them somewhere else in Toronto? Spill.</p>
      <div id="comment-status" role="status" aria-live="polite" class="${notice ? 'notice' : ''}">${notice || ''}</div>
      <form class="comment-form" method="post" action="/rumor/${a.slug}/comments" novalidate>
        <input type="hidden" name="token" value="${commentToken}">
        <div class="hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
        <div class="field">
          <label for="c-name">Name or nickname</label>
          <input id="c-name" name="name" required maxlength="60" autocomplete="nickname" value="${form.name || ''}">
        </div>
        <div class="field">
          <label for="c-body">Your comment</label>
          <textarea id="c-body" name="body" required minlength="2" maxlength="2000" rows="4" aria-describedby="c-help">${form.body || ''}</textarea>
          <p id="c-help" class="help">Be kind, no personal info. Comments with links are held for review.</p>
        </div>
        <button class="btn" type="submit">Post comment</button>
      </form>
      <ol class="comment-list" id="comment-list">
        ${comments.map(commentItem)}
      </ol>
    </section>
  </article>

  ${related.length ? html`<section class="wrap" aria-labelledby="more-h">
    <h2 id="more-h" class="section-title">More Toronto rumours</h2>
    <div class="grid">${related.map((r) => card(r))}</div>
  </section>` : ''}`;

  return layout(res, {
    title: `${a.meta_title || a.title} | Rumors`,
    ogTitle: a.meta_title || a.title,
    description, path: `/rumor/${a.slug}`, type: 'article', image: ogImg, schema,
    head: html`<meta property="article:published_time" content="${a.published_at}">
<meta property="article:modified_time" content="${a.updated_at}">
<meta property="article:section" content="Celebrity sightings">
${[...celebs, ...tags].map((t) => html`<meta property="article:tag" content="${t}">`)}
<link rel="alternate" type="text/markdown" href="/rumor/${a.slug}.md" title="Markdown version">
${img ? html`<link rel="preload" as="image" imagesrcset="${raw(JSON.parse(img.widths).map((w) => `${imageUrl(img, w)} ${w}w`).join(', '))}" imagesizes="(max-width: 900px) 100vw, 860px" fetchpriority="high">` : ''}`,
    scripts: html`<script src="${asset('/js/article.js')}" defer nonce="${res.locals.nonce}"></script>`,
    body,
  });
}

export function commentItem(c) {
  return html`<li class="comment" id="comment-${c.id}">
    <p class="comment-meta"><strong>${c.name}</strong> · <time datetime="${c.created_at}">${timeAgo(c.created_at)}</time></p>
    <p class="comment-body">${c.body}</p>
  </li>`;
}

export function notFoundPage(res) {
  return layout(res, {
    title: 'Not found | Rumors', description: 'This rumour could not be found.', path: '/', robots: 'noindex',
    body: html`<div class="wrap narrow center"><h1>That rumour vanished.</h1><p>Maybe it was never true. <a href="/">See what Toronto is talking about</a>.</p></div>`,
  });
}

export function sendRumorPage(res, { token, error = '', form = {}, done = false }) {
  const title = 'Send Us a Rumor: Share a Toronto Celebrity Sighting | Rumors';
  const description = 'Spotted a celebrity in Toronto? Send Rumors your sighting in writing or record yourself telling it. We review every tip before anything is published.';
  const body = done ? html`<div class="wrap narrow send-done">
      <p class="section-label">Got it</p>
      <h1>Thanks! Your rumor is in.</h1>
      <p class="lede">Our team reviews every tip. If we publish it, we may edit it for length and clarity. We never publish your email.</p>
      <p><a class="btn" href="/">Back to the latest rumours</a></p>
    </div>` : html`<div class="wrap narrow">
    <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page">Send us a rumor</li></ol></nav>
    <header class="tag-head">
      <p class="section-label">Tips</p>
      <h1>Send us a rumor</h1>
      <p class="lede">Spotted someone famous around Toronto? Tell us what happened in writing, or just hit record and tell us out loud. Every tip is reviewed before anything goes up.</p>
    </header>
    ${error ? html`<p class="notice form-error" role="alert" id="form-error">${error}</p>` : ''}
    <form class="send-form" id="send-form" method="post" action="/send-a-rumor" enctype="multipart/form-data">
      <input type="hidden" name="token" value="${token}">
      <div class="hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>

      <fieldset>
        <legend>Who and where</legend>
        <div class="field"><label for="s-celebrity">Who did you see? <span class="req">(required)</span></label>
          <input id="s-celebrity" name="celebrity" required maxlength="120" value="${form.celebrity || ''}" placeholder="e.g. Drake"></div>
        <div class="grid-2">
          <div class="field"><label for="s-location">Where? <span class="req">(required)</span></label>
            <input id="s-location" name="location_name" required maxlength="120" value="${form.location_name || ''}" placeholder="Restaurant, bar, park, street…"></div>
          <div class="field"><label for="s-address">Address or neighbourhood</label>
            <input id="s-address" name="location_address" maxlength="200" value="${form.location_address || ''}" placeholder="e.g. King St W"></div>
        </div>
        <div class="field"><label for="s-when">When?</label>
          <input id="s-when" name="seen_when" maxlength="80" value="${form.seen_when || ''}" placeholder="e.g. Last Friday around 9pm"></div>
      </fieldset>

      <fieldset>
        <legend>Tell us what happened</legend>
        <p class="help">Write it, record it, or both. You need at least one.</p>
        <div class="field"><label for="s-story">In writing</label>
          <textarea id="s-story" name="story" rows="7" maxlength="5000" aria-describedby="s-story-help">${form.story || ''}</textarea>
          <p class="help" id="s-story-help">What were they doing, wearing, ordering? Who were they with? The more detail the better.</p></div>

        <div class="recorder" id="recorder" hidden>
          <p class="field-label" id="rec-label">Or record yourself</p>
          <div class="rec-controls" role="group" aria-labelledby="rec-label">
            <button type="button" class="btn btn-rec" id="rec-start"><span class="rec-dot" aria-hidden="true"></span> Record</button>
            <button type="button" class="btn btn-ghost" id="rec-stop" hidden>Stop</button>
            <button type="button" class="btn btn-ghost" id="rec-discard" hidden>Delete recording</button>
            <span class="rec-time" id="rec-time" aria-live="off">0:00 / 3:00</span>
          </div>
          <audio id="rec-playback" controls hidden></audio>
          <p class="help" id="rec-status" role="status" aria-live="polite">Up to 3 minutes. Your browser will ask for microphone access.</p>
        </div>

        <div class="field" id="audio-upload"><label for="s-audio">Or upload a voice recording</label>
          <input id="s-audio" name="audio" type="file" accept="audio/*">
          <p class="help">MP3, M4A, WAV, WebM or OGG, up to 15 MB.</p></div>

        <div class="field"><label for="s-photo">Photo of the place (optional)</label>
          <input id="s-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/avif">
          <p class="help">Please don't send photos of the celebrity taken without their permission. Location data is removed automatically.</p></div>
      </fieldset>

      <fieldset>
        <legend>About you (optional)</legend>
        <div class="grid-2">
          <div class="field"><label for="s-name">Name or nickname</label>
            <input id="s-name" name="name" maxlength="60" autocomplete="nickname" value="${form.name || ''}" placeholder="Shown if we publish. Blank = anonymous"></div>
          <div class="field"><label for="s-email">Email</label>
            <input id="s-email" name="email" type="email" maxlength="120" autocomplete="email" value="${form.email || ''}" placeholder="Only if we need to follow up"></div>
        </div>
        <p class="help">We never publish your email.</p>
      </fieldset>

      <label class="check"><input type="checkbox" name="consent" value="1" required ${form.consent ? html`checked` : ''}>
        <span>This is my own first-hand account, and Rumors may edit and publish it.</span></label>

      <button class="btn btn-send" type="submit" id="send-btn">Send my rumor</button>
      <p id="send-status" role="status" aria-live="polite" class="help"></p>
    </form>
  </div>`;

  return layout(res, {
    title, description, path: '/send-a-rumor', robots: done ? 'noindex' : undefined,
    schema: [{ '@type': 'ContactPage', url: abs('/send-a-rumor'), name: 'Send us a rumor', description, isPartOf: { '@id': `${config.siteUrl}/#website` } }],
    scripts: html`<script src="${asset('/js/send-rumor.js')}" defer nonce="${res.locals.nonce}"></script>`,
    body,
  });
}


/** "RUMORS / Toronto • Celebrities • Entertainment" section with the six categories. */
function categorySection(ranked) {
  const cats = categoryOverview(ranked);
  // Preview different stories in each card where possible, so the section doesn't repeat itself.
  const used = new Set();
  for (const c of cats) {
    const fresh = c.articles.filter((x) => !used.has(x.id));
    c.preview = [...fresh, ...c.articles.filter((x) => used.has(x.id))].slice(0, 2);
    c.preview.forEach((x) => used.add(x.id));
  }
  return html`<section class="wrap cats" aria-labelledby="cats-h">
    <header class="cats-head">
      <h2 id="cats-h" class="cats-title">Rumors</h2>
      <p class="cats-sub">Toronto <span aria-hidden="true">•</span> Celebrities <span aria-hidden="true">•</span> Entertainment</p>
    </header>
    <ul class="cat-grid">
      ${cats.map((c) => html`<li class="cat-card">
        <h3 class="cat-name"><a href="/category/${c.slug}">${c.name}</a></h3>
        <p class="cat-desc">${c.description}</p>
        ${c.articles.length ? html`<ul class="cat-preview">${c.preview.map((a) => html`<li><a href="/rumor/${a.slug}">${a.title}</a></li>`)}</ul>` : html`<p class="cat-empty">New stories coming soon.</p>`}
        <p class="cat-count">${c.articles.length} ${c.articles.length === 1 ? 'story' : 'stories'} <span aria-hidden="true">→</span></p>
      </li>`)}
    </ul>
  </section>`;
}

export function categoryPage(res, { cat, articles, ranked }) {
  const others = CATEGORIES.filter((c) => c.slug !== cat.slug);
  const isTrending = cat.slug === 'toronto-trending';
  return layout(res, {
    title: `${cat.seoTitle} | Rumors`, ogTitle: cat.seoTitle,
    description: `${cat.description} ${cat.intro}`.slice(0, 300), path: `/category/${cat.slug}`,
    schema: [
      { '@type': 'CollectionPage', url: abs(`/category/${cat.slug}`), name: cat.seoTitle, description: cat.intro,
        isPartOf: { '@id': `${config.siteUrl}/#website` }, about: { '@type': 'Thing', name: `${cat.name} in Toronto` },
        mainEntity: itemList(articles, cat.name) },
      breadcrumbs([{ name: 'Rumors', path: '/' }, { name: cat.name, path: `/category/${cat.slug}` }]),
    ],
    body: html`<div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page">${cat.name}</li></ol></nav>
      <header class="tag-head">
        <p class="section-label">Rumors · Toronto • Celebrities • Entertainment</p>
        <h1>${cat.name}</h1>
        <p class="lede">${cat.description}</p>
        ${isTrending ? html`<p class="how-ranked">Updated live: ranked by reads (10+ seconds on the page) and comments, weighted toward newer stories.</p>` : ''}
      </header>
      ${articles.length
        ? html`<div class="grid">${articles.map((a, i) => card(a, { eager: i === 0, headingLevel: 2 }))}</div>`
        : html`<p class="lede">No stories here yet. <a href="/send-a-rumor">Seen something? Send us a rumor.</a></p>`}
      <section class="more-cats" aria-labelledby="more-cats-h">
        <h2 id="more-cats-h" class="section-title">More categories</h2>
        <ul class="chips chips-lg">${others.map((c) => html`<li><a class="chip" href="/category/${c.slug}">${c.name}</a></li>`)}</ul>
      </section>
    </div>`,
  });
}
