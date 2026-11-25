import { html, formatDate, timeAgo } from '../html.js';
import { asset } from './layout.js';
import { getImage, imageUrl, publicImage } from '../images.js';
import { pendingCount } from '../submissions.js';
import { db } from '../db.js';
import { STORED, autoCategories } from '../categories.js';
import { list as csv } from '../html.js';

const MESSAGES = {
  saved: 'Article saved.', created: 'Article created.', deleted: 'Article deleted.',
  uploaded: 'Image(s) uploaded.', replaced: 'Image replaced — every article using it now shows the new version.',
  imgsaved: 'Image details saved.', imgdeleted: 'Image deleted.', comment: 'Comment updated.', commentdeleted: 'Comment deleted.',
  subrejected: 'Rumor rejected.', subdeleted: 'Submission and its files deleted.', scanning: 'Scan started. It takes about a minute. Refresh to see new finds.', finddeleted: 'Find deleted forever. Future scans will skip that story.', finddeletedall: 'All dismissed finds deleted forever. Future scans will skip those stories.', watchsaved: 'Watchlists saved. They are used from the next scan.', drafted: 'Draft created from the web find. Rewrite it in your own words before publishing.', aidone: 'The AI wrote this draft. Read it, check the facts and the photo, then publish.', writing: 'The AI is writing the article and looking for a free-to-use photo. This takes 1 to 3 minutes; this page refreshes by itself.', approved: 'Approved! A draft article was created from the tip. Edit it, add a cover photo, then publish.',
};

export function adminLayout(req, res, { title, body, active, refresh = 0 }) {
  const msg = MESSAGES[req.query.msg];
  const err = req.query.err;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
${refresh ? html`<meta http-equiv="refresh" content="${refresh}">` : ''}
<title>${title} · Rumors admin</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${asset('/css/admin.css')}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${req.admin ? html`<header class="bar">
  <a class="logo" href="/admin">Rumors<span>.</span> <small>admin</small></a>
  <nav aria-label="Admin">
    <a href="/admin" ${active === 'articles' ? html`aria-current="page"` : ''}>Articles</a>
    <a href="/admin/media" ${active === 'media' ? html`aria-current="page"` : ''}>Images</a>
    <a href="/admin/submissions" ${active === 'submissions' ? html`aria-current="page"` : ''}>Rumor tips${(() => { const n = pendingCount(); return n ? html` <span class="count" aria-label="${n} waiting">${n}</span>` : ''; })()}</a>
    <a href="/admin/radar" ${active === 'radar' ? html`aria-current="page"` : ''}>Web radar${(() => { const n = db.prepare("SELECT COUNT(*) n FROM web_finds WHERE status = 'new'").get().n; return n ? html` <span class="count" aria-label="${n} new">${n}</span>` : ''; })()}</a>
    <a href="/admin/comments" ${active === 'comments' ? html`aria-current="page"` : ''}>Comments</a>
    <a href="/" target="_blank" rel="noopener">View site ↗</a>
  </nav>
  <form method="post" action="/admin/logout" class="logout"><input type="hidden" name="_csrf" value="${req.admin.csrf}"><button class="link">Sign out</button></form>
</header>` : ''}
<main id="main" class="main" tabindex="-1">
  ${msg ? html`<p class="flash" role="status">${msg}</p>` : ''}
  ${err ? html`<p class="flash flash-err" role="alert">${err}</p>` : ''}
  ${body}
</main>
${req.admin ? html`<meta name="csrf-token" content="${req.admin.csrf}">` : ''}
<script src="${asset('/js/admin.js')}" defer nonce="${res.locals.nonce}"></script>
</body>
</html>`;
}

export function loginPage(req, res, { error, username = '' } = {}) {
  return adminLayout(req, res, {
    title: 'Sign in',
    body: html`<div class="login">
      <h1>Rumors<span class="dot">.</span> admin</h1>
      ${error ? html`<p class="flash flash-err" role="alert">${error}</p>` : ''}
      <form method="post" action="/admin/login" class="stack">
        <div class="field"><label for="u">Username</label><input id="u" name="username" autocomplete="username" required value="${username}"></div>
        <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn btn-primary">Sign in</button>
      </form>
    </div>`,
  });
}

export function dashboardPage(req, res, { articles, totals, filter, q }) {
  const tab = (key, label) => html`<a href="/admin?status=${key}" ${filter === key ? html`aria-current="page"` : ''}>${label}</a>`;
  return adminLayout(req, res, {
    title: 'Articles', active: 'articles',
    body: html`
    <div class="page-head">
      <h1>Articles</h1>
      <a class="btn btn-primary" href="/admin/articles/new">+ New article</a>
    </div>
    <ul class="kpis">
      <li><span>${totals.published}</span> published</li>
      <li><span>${totals.drafts}</span> drafts</li>
      <li><span>${totals.views.toLocaleString('en-CA')}</span> qualified reads</li>
      <li><span>${totals.comments.toLocaleString('en-CA')}</span> comments</li>
    </ul>
    <div class="toolbar">
      <nav class="tabs" aria-label="Filter articles">${tab('all', 'All')}${tab('published', 'Published')}${tab('draft', 'Drafts')}</nav>
      <form method="get" action="/admin" class="search" role="search">
        <input type="hidden" name="status" value="${filter}">
        <label class="visually-hidden" for="q">Search articles</label>
        <input id="q" name="q" type="search" placeholder="Search title, celebrity, place…" value="${q}">
        <button class="btn">Search</button>
      </form>
    </div>
    <div class="table-wrap">
    <table>
      <caption class="visually-hidden">Articles, ordered by live trending rank</caption>
      <thead><tr><th scope="col">Rank</th><th scope="col">Article</th><th scope="col">Status</th><th scope="col" class="num">Reads</th><th scope="col" class="num">Comments</th><th scope="col" class="num">Score</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
      <tbody>
      ${articles.length ? articles.map((a) => {
        const img = getImage(a.cover_image_id);
        return html`<tr>
        <td class="rank">${a.rank ? `#${a.rank}` : '—'}</td>
        <td class="title-cell">
          ${img ? html`<img src="${imageUrl(img, JSON.parse(img.widths)[0])}" alt="" width="64" height="40" loading="lazy">` : html`<span class="noimg" aria-hidden="true"></span>`}
          <div><a href="/admin/articles/${a.id}/edit"><strong>${a.title}</strong></a>
          <small>${a.location_name || 'No location'} · ${a.published_at ? formatDate(a.published_at) : 'unscheduled'}${a.featured ? ' · ★ featured' : ''}</small></div>
        </td>
        <td><span class="pill pill-${a.status}">${a.status}</span></td>
        <td class="num">${a.views.toLocaleString('en-CA')}</td>
        <td class="num">${a.comments_count}</td>
        <td class="num">${a.score != null ? a.score.toFixed(2) : '—'}</td>
        <td class="actions"><a href="/admin/articles/${a.id}/edit">Edit</a>${a.status === 'published' ? html` <a href="/rumor/${a.slug}" target="_blank" rel="noopener">View</a>` : ''}</td>
      </tr>`;
      }) : html`<tr><td colspan="7" class="empty">No articles found.</td></tr>`}
      </tbody>
    </table>
    </div>
    <p class="help">Rank = live homepage position. Score = (reads + comments × 5 + 1) ÷ (hours since publishing + 2)<sup>1.5</sup>, with a 25% boost for ★ featured. A read counts only after 10 seconds on the page, once per visitor per day.</p>`,
  });
}

export function editorPage(req, res, { a, error }) {
  const isNew = !a.id;
  const cover = getImage(a.cover_image_id);
  const local = a.published_at ? new Date(new Date(a.published_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  return adminLayout(req, res, {
    title: isNew ? 'New article' : `Edit: ${a.title}`, active: 'articles',
    body: html`
    <div class="page-head">
      <h1>${isNew ? 'New article' : 'Edit article'}</h1>
      ${!isNew && a.status === 'published' ? html`<a class="btn" href="/rumor/${a.slug}" target="_blank" rel="noopener">View live ↗</a>` : ''}
    </div>
    ${error ? html`<p class="flash flash-err" role="alert">${error}</p>` : ''}
    <form method="post" action="${isNew ? '/admin/articles' : `/admin/articles/${a.id}`}" enctype="multipart/form-data" class="editor" id="editor">
      <input type="hidden" name="_csrf" value="${req.admin.csrf}">
      <div class="editor-main">
        <div class="field">
          <label for="title">Headline</label>
          <input id="title" name="title" required maxlength="160" value="${a.title}" class="input-lg" placeholder="You won’t believe who just walked into…">
        </div>
        <div class="field">
          <label for="slug">URL slug <small>(leave blank to generate from headline)</small></label>
          <div class="prefix"><span>/rumor/</span><input id="slug" name="slug" maxlength="90" value="${a.slug}" pattern="[a-z0-9-]*"></div>
        </div>
        <div class="field">
          <label for="excerpt">Summary / dek <small>(shown on cards, in search results and the “30 seconds” box — 1–2 sentences)</small></label>
          <textarea id="excerpt" name="excerpt" rows="2" maxlength="300" required data-count>${a.excerpt}</textarea>
        </div>
        <div class="field">
          <div class="label-row"><label for="body">Story</label>
            <div class="md-toolbar" role="toolbar" aria-label="Formatting" aria-controls="body">
              <button type="button" data-md="h2" title="Heading">H2</button>
              <button type="button" data-md="bold" title="Bold"><b>B</b></button>
              <button type="button" data-md="italic" title="Italic"><i>I</i></button>
              <button type="button" data-md="link" title="Link">Link</button>
              <button type="button" data-md="quote" title="Quote">“ ”</button>
              <button type="button" data-md="list" title="Bullet list">• List</button>
              <button type="button" data-pick="insert" class="accent">+ Image</button>
              <button type="button" id="preview-btn" aria-expanded="false" aria-controls="preview">Preview</button>
            </div>
          </div>
          <textarea id="body" name="body" rows="22" class="mono">${a.body}</textarea>
          <p class="help">Blank line = new paragraph. <code>## Heading</code>, <code>**bold**</code>, <code>*italic*</code>, <code>[text](https://…)</code>, <code>> quote</code>, <code>- list</code>. Images: use “+ Image”.</p>
          <div id="preview" class="preview prose" hidden aria-live="polite"></div>
        </div>
        <div class="field">
          <label for="faq">FAQ <small>(helps Google &amp; AI assistants — one “Q:” line then one “A:” line per question)</small></label>
          <textarea id="faq" name="faq" rows="6" class="mono" placeholder="Q: Where was Drake spotted?&#10;A: At ...">${a.faq}</textarea>
        </div>
      </div>

      <aside class="editor-side">
        <section class="panel">
          <h2>Publish</h2>
          <div class="field"><label for="status">Status</label>
            <select id="status" name="status"><option value="draft" ${a.status !== 'published' ? html`selected` : ''}>Draft (hidden)</option><option value="published" ${a.status === 'published' ? html`selected` : ''}>Published</option></select></div>
          <div class="field"><label for="published_at">Publish date &amp; time</label>
            <input id="published_at" name="published_at" type="datetime-local" value="${local}"><p class="help">Blank = now. Future date = scheduled.</p></div>
          <label class="check"><input type="checkbox" name="featured" value="1" ${a.featured ? html`checked` : ''}> ★ Featured (ranking boost)</label>
          <div class="field"><label for="author_name">Author name</label><input id="author_name" name="author_name" maxlength="80" value="${a.author_name}"></div>
          <button class="btn btn-primary btn-block" type="submit">${isNew ? 'Create article' : 'Save changes'}</button>
        </section>

        <section class="panel">
          <h2>Cover image</h2>
          <input type="hidden" name="cover_image_id" id="cover_image_id" value="${a.cover_image_id || ''}">
          <div id="cover-preview" class="cover-preview">${cover ? html`<img src="${imageUrl(cover, JSON.parse(cover.widths)[0])}" alt="${cover.alt}">` : html`<span>No cover image</span>`}</div>
          <div class="row">
            <button type="button" class="btn" data-pick="cover">Choose from library</button>
            <button type="button" class="btn link" id="cover-clear">Remove</button>
          </div>
          <div class="field"><label for="cover_file">…or upload a new one</label><input id="cover_file" name="cover_file" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif"></div>
          <div class="field"><label for="cover_alt">Alt text for new upload</label><input id="cover_alt" name="cover_alt" maxlength="300" placeholder="Describe the photo for screen readers"></div>
        </section>

        <section class="panel">
          <h2>Categories</h2>
          ${(() => {
            const chosen = csv(a.categories);
            const auto = autoCategories(a);
            return html`<fieldset class="cat-checks"><legend class="visually-hidden">Categories</legend>
              ${STORED.map((c) => html`<label class="check"><input type="checkbox" name="categories" value="${c.slug}" ${(chosen.length ? chosen.includes(c.slug) : auto.includes(c.slug)) ? html`checked` : ''}> ${c.name}</label>`)}
            </fieldset>
            <p class="help">${chosen.length ? 'Chosen by you.' : 'Ticked automatically from the tags and location. Change them to choose yourself.'} “Toronto Trending” is automatic: the 8 most-read and most-discussed stories.</p>`;
          })()}
        </section>

        <section class="panel">
          <h2>Where &amp; who</h2>
          <div class="field"><label for="location_name">Location name</label><input id="location_name" name="location_name" maxlength="120" value="${a.location_name}" placeholder="e.g. Sotto Sotto"></div>
          <div class="field"><label for="location_address">Street address</label><input id="location_address" name="location_address" maxlength="200" value="${a.location_address}" placeholder="120 Avenue Rd, Toronto, ON"></div>
          <div class="field"><label for="neighbourhood">Neighbourhood</label><input id="neighbourhood" name="neighbourhood" maxlength="80" value="${a.neighbourhood}" placeholder="Yorkville"></div>
          <div class="field"><label for="celebrities">Celebrities <small>(comma separated)</small></label><input id="celebrities" name="celebrities" maxlength="400" value="${a.celebrities}" placeholder="Drake, The Weeknd"></div>
          <div class="field"><label for="tags">Tags <small>(comma separated)</small></label><input id="tags" name="tags" maxlength="400" value="${a.tags}" placeholder="TIFF, Restaurants"></div>
        </section>

        <section class="panel">
          <h2>Search &amp; sharing</h2>
          <div class="field"><label for="meta_title">SEO title <small>(optional, ~60 chars)</small></label><input id="meta_title" name="meta_title" maxlength="120" value="${a.meta_title}" data-count></div>
          <div class="field"><label for="meta_description">Meta description <small>(optional, ~155 chars)</small></label><textarea id="meta_description" name="meta_description" rows="3" maxlength="300" data-count>${a.meta_description}</textarea></div>
        </section>
      </aside>
    </form>
    ${!isNew ? html`<form method="post" action="/admin/articles/${a.id}/delete" class="danger-zone" data-confirm="Delete “${a.title}” permanently? Its comments and view stats will be deleted too. This cannot be undone.">
      <input type="hidden" name="_csrf" value="${req.admin.csrf}">
      <h2>Danger zone</h2>
      <p>Deleting removes the article, its comments and its stats. Images stay in the library. Tip: set it to Draft to hide it instead.</p>
      <button class="btn btn-danger">Delete article</button>
    </form>` : ''}
    ${mediaDialog()}`,
  });
}

function mediaDialog() {
  return html`<dialog id="media-dialog" aria-labelledby="media-dialog-h">
    <div class="dialog-head"><h2 id="media-dialog-h">Image library</h2><button type="button" class="btn link" data-close aria-label="Close">✕</button></div>
    <form id="media-upload" class="dialog-upload">
      <label for="dlg-file">Upload new</label>
      <input id="dlg-file" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif">
      <label for="dlg-alt" class="visually-hidden">Alt text</label>
      <input id="dlg-alt" placeholder="Alt text (describe the photo)" maxlength="300">
      <button class="btn btn-primary" type="submit">Upload</button>
    </form>
    <p id="media-status" role="status" class="help"></p>
    <ul id="media-grid" class="media-grid media-pick"></ul>
  </dialog>`;
}

export function mediaPage(req, res, { images }) {
  return adminLayout(req, res, {
    title: 'Images', active: 'media',
    body: html`
    <div class="page-head"><h1>Images</h1></div>
    <form method="post" action="/admin/media" enctype="multipart/form-data" class="panel upload-panel">
      <input type="hidden" name="_csrf" value="${req.admin.csrf}">
      <div class="field"><label for="files">Upload images <small>(JPG, PNG, WebP, AVIF, GIF · up to 15 MB each · resized &amp; optimised automatically, location data removed)</small></label>
      <input id="files" name="files" type="file" multiple required accept="image/jpeg,image/png,image/webp,image/avif,image/gif"></div>
      <div class="field"><label for="alt">Alt text <small>(applies to all; edit each below)</small></label><input id="alt" name="alt" maxlength="300"></div>
      <button class="btn btn-primary">Upload</button>
    </form>
    <ul class="media-grid">
      ${images.map(({ img, usage }) => html`<li class="media-card">
        <img src="${imageUrl(img, JSON.parse(img.widths)[0])}" alt="${img.alt}" width="${JSON.parse(img.widths)[0]}" height="${Math.round(img.height * JSON.parse(img.widths)[0] / img.width)}" loading="lazy">
        <p class="help">${img.width}×${img.height} · updated ${timeAgo(img.updated_at)} · used in ${usage.length} article${usage.length === 1 ? '' : 's'}</p>
        <form method="post" action="/admin/media/${img.id}" class="stack-sm">
          <input type="hidden" name="_csrf" value="${req.admin.csrf}">
          <label for="alt-${img.id}">Alt text</label><input id="alt-${img.id}" name="alt" maxlength="300" value="${img.alt}">
          <label for="credit-${img.id}">Caption / credit</label><input id="credit-${img.id}" name="credit" maxlength="200" value="${img.credit}">
          <button class="btn">Save details</button>
        </form>
        <form method="post" action="/admin/media/${img.id}/replace" enctype="multipart/form-data" class="stack-sm">
          <input type="hidden" name="_csrf" value="${req.admin.csrf}">
          <label for="rep-${img.id}">Replace image file</label>
          <input id="rep-${img.id}" name="file" type="file" required accept="image/jpeg,image/png,image/webp,image/avif,image/gif">
          <button class="btn">Replace</button>
        </form>
        <form method="post" action="/admin/media/${img.id}/delete" data-confirm="${usage.length ? `This image is used in: ${usage.map((u) => u.title).join('; ')}. Delete anyway? It will disappear from those articles.` : 'Delete this image permanently?'}">
          <input type="hidden" name="_csrf" value="${req.admin.csrf}">
          <button class="btn link danger">Delete</button>
        </form>
      </li>`)}
    </ul>
    ${images.length ? '' : html`<p class="empty">No images yet.</p>`}`,
  });
}

export function commentsPage(req, res, { comments, filter }) {
  const tab = (key, label) => html`<a href="/admin/comments?status=${key}" ${filter === key ? html`aria-current="page"` : ''}>${label}</a>`;
  const act = (c, action, label, cls = '') => html`<form method="post" action="/admin/comments/${c.id}/${action}" ${action === 'delete' ? html`data-confirm="Delete this comment permanently?"` : ''}>
    <input type="hidden" name="_csrf" value="${req.admin.csrf}"><button class="btn ${cls}">${label}</button></form>`;
  return adminLayout(req, res, {
    title: 'Comments', active: 'comments',
    body: html`<div class="page-head"><h1>Comments</h1></div>
    <nav class="tabs" aria-label="Filter comments">${tab('all', 'All')}${tab('pending', 'Awaiting review')}${tab('visible', 'Visible')}${tab('hidden', 'Hidden')}</nav>
    <ul class="comment-admin">
      ${comments.map((c) => html`<li>
        <p><strong>${c.name}</strong> on <a href="/rumor/${c.slug}#comment-${c.id}" target="_blank" rel="noopener">${c.title}</a> · ${timeAgo(c.created_at)} <span class="pill pill-${c.status}">${c.status}</span></p>
        <p class="comment-text">${c.body}</p>
        <div class="row">
          ${c.status !== 'visible' ? act(c, 'approve', 'Approve / show') : ''}
          ${c.status !== 'hidden' ? act(c, 'hide', 'Hide') : ''}
          ${act(c, 'delete', 'Delete', 'btn-danger')}
        </div>
      </li>`)}
    </ul>
    ${comments.length ? '' : html`<p class="empty">No comments here.</p>`}`,
  });
}

export { publicImage };


export function submissionsPage(req, res, { subs, filter }) {
  const tab = (key, label) => html`<a href="/admin/submissions?status=${key}" ${filter === key ? html`aria-current="page"` : ''}>${label}</a>`;
  return adminLayout(req, res, {
    title: 'Rumor tips', active: 'submissions',
    body: html`<div class="page-head"><h1>Rumor tips</h1></div>
    <p class="help">Sent by readers through the “Send us a rumor” button. Approving one creates a draft article you can edit and publish.</p>
    <nav class="tabs" aria-label="Filter tips">${tab('pending', 'Waiting for review')}${tab('approved', 'Approved')}${tab('rejected', 'Rejected')}${tab('all', 'All')}</nav>
    <ul class="comment-admin">
      ${subs.map((s) => html`<li>
        <p><a href="/admin/submissions/${s.id}"><strong>${s.celebrity}</strong> at ${s.location_name}</a> · ${timeAgo(s.created_at)} <span class="pill pill-${s.status === 'approved' ? 'published' : s.status === 'pending' ? 'pending' : 'hidden'}">${s.status}</span></p>
        <p class="comment-text">${s.story ? (s.story.length > 220 ? s.story.slice(0, 220) + '…' : s.story) : ''}</p>
        <p class="help">${s.audio_file ? '🎙 Voice recording · ' : ''}${s.photo_file ? '📷 Photo · ' : ''}From ${s.name || 'anonymous'}</p>
        <a class="btn" href="/admin/submissions/${s.id}">Review</a>
      </li>`)}
    </ul>
    ${subs.length ? '' : html`<p class="empty">Nothing here.</p>`}`,
  });
}

export function submissionPage(req, res, { s, job, aiOn }) {
  const row = (label, value) => (value ? html`<div><dt>${label}</dt><dd>${value}</dd></div>` : '');
  const act = (action, label, cls, confirmText) => html`<form method="post" action="/admin/submissions/${s.id}/${action}" ${confirmText ? html`data-confirm="${confirmText}"` : ''}>
    <input type="hidden" name="_csrf" value="${req.admin.csrf}"><button class="btn ${cls}">${label}</button></form>`;
  return adminLayout(req, res, {
    title: `Tip: ${s.celebrity}`, active: 'submissions', refresh: job?.state === 'writing' ? 10 : 0,
    body: html`<p><a href="/admin/submissions">← All tips</a></p>
    <div class="page-head"><h1>${s.celebrity} at ${s.location_name}</h1><span class="pill pill-${s.status === 'approved' ? 'published' : s.status === 'pending' ? 'pending' : 'hidden'}">${s.status}</span></div>
    <div class="sub-grid">
      <section class="panel">
        <h2>The tip</h2>
        <dl class="sub-dl">
          ${row('Who', s.celebrity)}${row('Where', s.location_name)}${row('Address / area', s.location_address)}${row('When', s.seen_when)}
          ${row('Sent', `${formatDate(s.created_at)} (${timeAgo(s.created_at)})`)}
          ${row('From', s.name || 'Anonymous')}
          ${s.email ? html`<div><dt>Email</dt><dd><a href="mailto:${s.email}">${s.email}</a> <small>(private)</small></dd></div>` : ''}
        </dl>
        ${s.story ? html`<h3>Their story</h3><p class="comment-text">${s.story}</p>` : html`<p class="help">No written story. Listen to the recording.</p>`}
      </section>
      <section class="panel">
        ${s.audio_file ? html`<h2>Voice recording</h2><audio controls preload="metadata" src="/admin/submissions/${s.id}/audio"></audio>` : ''}
        ${s.photo_file ? html`<h2>Photo</h2><img class="sub-photo" src="/admin/submissions/${s.id}/photo" alt="Photo sent with the tip">` : ''}
        ${!s.audio_file && !s.photo_file ? html`<p class="help">No recording or photo attached.</p>` : ''}
      </section>
    </div>
    <div class="row sub-actions">
      ${s.status === 'approved' && s.article_id
        ? html`<a class="btn btn-primary" href="/admin/articles/${s.article_id}/edit">Open the article</a>`
        : job?.state === 'writing' ? html`<button class="btn" disabled>Writing… ${Math.floor((Date.now() - job.started) / 1000)}s</button>`
        : act('approve', job?.state === 'error' ? 'Try again' : 'Approve → create draft article', 'btn-primary')}
      ${s.status !== 'rejected' ? act('reject', 'Reject', '') : ''}
      ${act('delete', 'Delete permanently', 'btn-danger', 'Delete this tip and its recording and photo permanently? This cannot be undone.')}
    </div>
    ${job?.state === 'error' ? html`<p class="find-error" role="alert">${job.error}</p>` : ''}
    <p class="help">Approving creates a <strong>draft</strong> article ${aiOn ? 'that the AI writes in full from the tip, with the reader’s photo as cover or a free-to-use photo from Wikimedia Commons' : 'with the tip’s details (and the photo as cover, if any)'}. Nothing goes live until you publish it.</p>`,
  });
}


export function radarPage(req, res, { jobFor, aiOn, finds, filter, question, q, questions, counts, lastRun, running, nextRun, celebs, places }) {
  const qs = (o) => new URLSearchParams({ status: filter, ...(question ? { question } : {}), ...(q ? { q } : {}), ...o }).toString();
  const statusTab = (key, label) => html`<a href="/admin/radar?${qs({ status: key })}" ${filter === key ? html`aria-current="page"` : ''}>${label} <small>${counts[key] ?? ''}</small></a>`;
  const act = (f, action, label, cls = '', confirmText = '') => html`<form method="post" action="/admin/radar/${f.id}/${action}" ${confirmText ? html`data-confirm="${confirmText}"` : ''}>
    <input type="hidden" name="_csrf" value="${req.admin.csrf}"><input type="hidden" name="back" value="${qs({})}"><button class="btn ${cls}">${label}</button></form>`;
  const labelFor = Object.fromEntries(questions.map((x) => [x.key, x.label]));
  const job = (f) => jobFor(`radar:${f.id}`);
  const writing = finds.some((f) => job(f)?.state === 'writing');
  const draftBtn = (f) => {
    const j = job(f);
    if (f.status === 'used' && f.article_id) return html`<a class="btn btn-primary" href="/admin/articles/${f.article_id}/edit">Open draft</a>`;
    if (j?.state === 'writing') return html`<button class="btn" disabled>Writing… ${Math.floor((Date.now() - j.started) / 1000)}s</button>`;
    return html`${act(f, 'draft', j?.state === 'error' ? 'Try again' : aiOn ? 'Create draft' : 'Create draft', 'btn-primary')}${j?.state === 'error' ? html`<p class="find-error" role="alert">${j.error}</p>` : ''}`;
  };
  return adminLayout(req, res, {
    title: 'Web radar', active: 'radar', refresh: writing || running ? 10 : 0,
    body: html`<div class="page-head">
      <h1>Web radar</h1>
      <form method="post" action="/admin/radar/scan"><input type="hidden" name="_csrf" value="${req.admin.csrf}">
        <button class="btn btn-primary" ${running ? html`disabled` : ''}>${running ? 'Scanning…' : 'Scan now'}</button></form>
    </div>
    <p class="help">Every day the radar searches Google News and Toronto outlets (Daily Hive, Narcity) for celebrity sightings and rumours in Toronto, and keeps the relevant ones here.
      ${lastRun ? html`Last scan: <strong>${timeAgo(lastRun.started_at)}</strong>, checked ${lastRun.checked} results, ${lastRun.added} new.` : 'No scan yet.'}
      Next scan: ${running ? 'running now' : nextRun}.</p>
    ${running ? html`<p class="flash" role="status">Scanning now. This takes about a minute. Refresh the page to see new finds.</p>` : ''}

    <nav class="q-chips" aria-label="Filter by question">
      <a href="/admin/radar?${qs({ question: '' })}" ${!question ? html`aria-current="page"` : ''}>All questions</a>
      ${questions.map((x) => html`<a href="/admin/radar?${qs({ question: x.key })}" ${question === x.key ? html`aria-current="page"` : ''}>${x.label} <small>${x.count}</small></a>`)}
    </nav>

    <div class="toolbar">
      <nav class="tabs" aria-label="Filter by status">${statusTab('new', 'New')}${statusTab('saved', 'Saved')}${statusTab('used', 'Turned into drafts')}${statusTab('dismissed', 'Dismissed')}${statusTab('all', 'All')}</nav>
      <form method="get" action="/admin/radar" class="search" role="search">
        <input type="hidden" name="status" value="${filter}">${question ? html`<input type="hidden" name="question" value="${question}">` : ''}
        <label class="visually-hidden" for="rq">Search finds</label>
        <input id="rq" name="q" type="search" placeholder="Search celebrity, place, headline…" value="${q}">
        <button class="btn">Search</button>
      </form>
    </div>

    ${filter === 'dismissed' && finds.length ? html`<form class="row bulk-delete" method="post" action="/admin/radar/dismissed/delete-all" data-confirm="Delete all ${counts.dismissed} dismissed finds forever? This cannot be undone, and future scans will skip these stories.">
      <input type="hidden" name="_csrf" value="${req.admin.csrf}"><button class="btn btn-danger">Delete all dismissed forever</button>
      <span class="help">Dismissed finds are also cleared automatically after 30 days.</span></form>` : ''}
    <ul class="finds">
      ${finds.map((f) => html`<li class="find ${f.status === 'saved' ? 'is-saved' : ''}">
        <div class="find-main">
          <p class="find-meta"><strong>${f.source || 'Web'}</strong> · ${f.published_at ? timeAgo(f.published_at) : `found ${timeAgo(f.found_at)}`} · relevance ${f.score}/12</p>
          <h2 class="find-title"><a href="${f.url}" target="_blank" rel="noopener noreferrer nofollow">${f.title} <span class="visually-hidden">(opens source in a new tab)</span>↗</a></h2>
          ${f.snippet ? html`<p class="find-snippet">${f.snippet}</p>` : ''}
          <p class="find-tags">
            ${f.celebrities ? f.celebrities.split(', ').map((c) => html`<span class="tagc">★ ${c}</span>`) : ''}
            ${f.places ? f.places.split(', ').map((p) => html`<span class="tagp">📍 ${p}</span>`) : ''}
          </p>
          <p class="help">Answers: ${f.questions.split(',').filter(Boolean).map((k) => labelFor[k]).filter(Boolean).join(' · ')}</p>
        </div>
        <div class="find-actions">
          ${draftBtn(f)}
          ${f.status === 'saved' ? act(f, 'unsave', '★ Saved') : f.status !== 'used' ? act(f, 'save', '☆ Save') : ''}
          ${f.status !== 'dismissed' ? act(f, 'dismiss', 'Dismiss') : html`${act(f, 'restore', 'Restore')}${act(f, 'delete', 'Delete forever', 'btn-danger', 'Delete this find forever? It cannot be undone, and future scans will skip this story.')}`}
        </div>
      </li>`)}
    </ul>
    ${finds.length ? '' : html`<p class="empty">${lastRun ? 'Nothing here yet. Try another filter, or run a scan.' : 'Run your first scan to start finding rumours.'}</p>`}

    <details class="panel watch">
      <summary><strong>Watchlists</strong>: who and where the radar looks for</summary>
      <form method="post" action="/admin/radar/watchlists" class="stack">
        <input type="hidden" name="_csrf" value="${req.admin.csrf}">
        <div class="field"><label for="w-celebs">Celebrities to watch <small>(comma separated; everyone in your articles is added automatically; about 15 are searched by name each day, rotating)</small></label>
          <textarea id="w-celebs" name="celebs" rows="5">${celebs}</textarea></div>
        <div class="field"><label for="w-places">Places to watch <small>(restaurants, bars, hotels, neighbourhoods)</small></label>
          <textarea id="w-places" name="places" rows="5">${places}</textarea></div>
        <button class="btn">Save watchlists</button>
      </form>
    </details>
    <p class="help">Only headlines, short snippets and links are stored. Use finds as leads: verify them, and write stories in your own words. Never copy the source’s text or photos.</p>
    <p class="help">${aiOn ? html`<strong>Create draft</strong> asks the AI to research the lead and write a full first-person draft, and adds a free-to-use cover photo from Wikimedia Commons (with its credit). Read it and check the facts before publishing.` : html`<strong>Tip:</strong> add <code>ANTHROPIC_API_KEY=…</code> to the <code>.env</code> file and restart, and <strong>Create draft</strong> will have Claude write the full article and find a cover photo for you.`}</p>`,
  });
}
