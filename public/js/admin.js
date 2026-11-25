// Rumors admin: confirmations, Markdown toolbar, image picker, live preview, character counters.
(() => {
  'use strict';
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content;

  // Confirm destructive actions.
  document.querySelectorAll('form[data-confirm]').forEach((f) =>
    f.addEventListener('submit', (e) => { if (!confirm(f.dataset.confirm)) e.preventDefault(); }));

  // Character counters.
  document.querySelectorAll('[data-count]').forEach((el) => {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (!label) return;
    const c = document.createElement('span');
    c.className = 'counter';
    c.setAttribute('aria-hidden', 'true');
    label.append(c);
    const upd = () => { c.textContent = `${el.value.length}/${el.maxLength}`; };
    el.addEventListener('input', upd); upd();
  });

  const body = document.getElementById('body');
  if (!body) return;

  // Warn before leaving with unsaved changes.
  const editor = document.getElementById('editor');
  let dirty = false;
  editor.addEventListener('input', () => { dirty = true; });
  editor.addEventListener('submit', () => { dirty = false; });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // Auto-slug while slug field untouched.
  const title = document.getElementById('title');
  const slug = document.getElementById('slug');
  let slugTouched = !!slug.value;
  slug.addEventListener('input', () => { slugTouched = true; });
  title.addEventListener('input', () => {
    if (!slugTouched) slug.value = title.value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
  });

  // ---- Markdown toolbar ----
  function wrap(before, after = before, placeholder = 'text') {
    const { selectionStart: s, selectionEnd: e, value } = body;
    const sel = value.slice(s, e) || placeholder;
    body.setRangeText(before + sel + after, s, e, 'end');
    body.setSelectionRange(s + before.length, s + before.length + sel.length);
    body.focus(); body.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function block(text) {
    const s = body.selectionStart;
    const pre = body.value.slice(0, s);
    const sep = pre === '' || pre.endsWith('\n\n') ? '' : pre.endsWith('\n') ? '\n' : '\n\n';
    body.setRangeText(`${sep}${text}\n\n`, s, body.selectionEnd, 'end');
    body.focus(); body.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function prefixLines(prefix) {
    const { selectionStart: s, selectionEnd: e, value } = body;
    const sel = value.slice(s, e) || 'Item';
    block(sel.split('\n').map((l) => prefix + l).join('\n'));
  }
  document.querySelectorAll('[data-md]').forEach((b) => b.addEventListener('click', () => {
    switch (b.dataset.md) {
      case 'bold': return wrap('**');
      case 'italic': return wrap('*');
      case 'h2': return prefixLines('## ');
      case 'quote': return prefixLines('> ');
      case 'list': return prefixLines('- ');
      case 'link': {
        const url = prompt('Link URL (https://…)');
        if (url) wrap('[', `](${url})`, 'link text');
      }
    }
  }));

  // ---- Live preview ----
  const previewBtn = document.getElementById('preview-btn');
  const preview = document.getElementById('preview');
  async function refreshPreview() {
    const r = await fetch('/admin/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ body: body.value }) });
    if (r.ok) preview.innerHTML = (await r.json()).html; // sanitised server-side
  }
  let pt;
  previewBtn.addEventListener('click', () => {
    const open = preview.hidden;
    preview.hidden = !open;
    previewBtn.setAttribute('aria-expanded', String(open));
    if (open) refreshPreview();
  });
  body.addEventListener('input', () => { if (!preview.hidden) { clearTimeout(pt); pt = setTimeout(refreshPreview, 400); } });

  // ---- Image picker dialog ----
  const dialog = document.getElementById('media-dialog');
  const grid = document.getElementById('media-grid');
  const status = document.getElementById('media-status');
  const coverId = document.getElementById('cover_image_id');
  const coverPreview = document.getElementById('cover-preview');
  let mode = 'insert';
  let opener = null;

  function setCover(img) {
    coverId.value = img ? img.id : '';
    coverPreview.replaceChildren();
    if (img) { const i = new Image(); i.src = img.thumb; i.alt = img.alt; coverPreview.append(i); }
    else { const s = document.createElement('span'); s.textContent = 'No cover image'; coverPreview.append(s); }
    dirty = true;
  }
  function choose(img) {
    if (mode === 'cover') setCover(img);
    else block(`![${(img.alt || '').replace(/[\[\]]/g, '')}](image:${img.id})`);
    dialog.close();
  }
  function tile(img) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const i = new Image(); i.src = img.thumb; i.alt = ''; i.loading = 'lazy';
    const s = document.createElement('span'); s.textContent = img.alt || img.original_name || `Image ${img.id}`;
    b.setAttribute('aria-label', `Use image: ${s.textContent}`);
    b.append(i, s);
    b.addEventListener('click', () => choose(img));
    li.append(b);
    return li;
  }
  async function openPicker(m, btn) {
    mode = m; opener = btn;
    document.getElementById('media-dialog-h').textContent = m === 'cover' ? 'Choose a cover image' : 'Insert an image into the story';
    status.textContent = 'Loading…';
    dialog.showModal();
    const r = await fetch('/admin/api/media', { headers: { Accept: 'application/json' } });
    const imgs = r.ok ? await r.json() : [];
    grid.replaceChildren(...imgs.map(tile));
    status.textContent = imgs.length ? `${imgs.length} images. Choose one, or upload a new one.` : 'No images yet — upload one.';
  }
  document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => openPicker(b.dataset.pick, b)));
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => opener?.focus());
  document.getElementById('cover-clear').addEventListener('click', () => setCover(null));

  document.getElementById('media-upload').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('dlg-file').files[0];
    if (!file) { status.textContent = 'Choose a file first.'; return; }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('alt', document.getElementById('dlg-alt').value);
    status.textContent = 'Uploading and optimising…';
    const r = await fetch('/admin/api/media', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: fd });
    const data = await r.json().catch(() => ({ error: 'Upload failed.' }));
    if (!r.ok) { status.textContent = data.error; return; }
    choose(data);
  });

  // Show a preview when a cover file is chosen for upload.
  document.getElementById('cover_file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    coverPreview.replaceChildren(Object.assign(new Image(), { src: URL.createObjectURL(f), alt: 'New cover (uploads when you save)' }));
  });
})();
