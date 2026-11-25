// Rumors article page: qualified-view tracking + progressive comment posting. ~2 KB, no dependencies.
(() => {
  'use strict';
  const article = document.querySelector('[data-view-token]');
  if (!article) return;

  // ---- A "view" counts after 10 seconds of the tab actually being visible. ----
  const NEEDED = 10_000;
  let visibleMs = 0;
  let since = document.visibilityState === 'visible' ? performance.now() : null;
  let sent = false;
  const tick = () => {
    if (sent) return;
    const now = performance.now();
    if (since !== null) { visibleMs += now - since; since = now; }
    if (visibleMs >= NEEDED) {
      sent = true;
      const token = article.dataset.viewToken;
      const ok = navigator.sendBeacon && navigator.sendBeacon('/api/views', new Blob([token], { type: 'text/plain' }));
      if (!ok) fetch('/api/views', { method: 'POST', body: token, keepalive: true, credentials: 'same-origin' }).catch(() => {});
      clearInterval(timer);
    }
  };
  const timer = setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') since = performance.now();
    else { tick(); since = null; }
  });

  // ---- Comments without a page reload (form still works with JS disabled). ----
  const form = document.querySelector('.comment-form');
  const status = document.getElementById('comment-status');
  const listEl = document.getElementById('comment-list');
  const heading = document.getElementById('comments-h');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    const name = form.elements.name;
    const body = form.elements.body;
    let invalid = null;
    for (const f of [name, body]) {
      const bad = !f.value.trim() || (f.minLength > 0 && f.value.trim().length < f.minLength);
      f.setAttribute('aria-invalid', bad ? 'true' : 'false');
      if (bad && !invalid) invalid = f;
    }
    e.preventDefault();
    if (invalid) { status.textContent = invalid === name ? 'Please add a name or nickname.' : 'Please write a comment.'; status.className = 'notice'; invalid.focus(); return; }

    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    status.textContent = 'Posting…';
    try {
      const res = await fetch(form.action, {
        method: 'POST', credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not post your comment. Please try again.');
      status.className = 'notice';
      if (data.pending) status.textContent = 'Thanks! Your comment is waiting for review.';
      else {
        status.textContent = 'Thanks, your comment is live.';
        const tpl = document.createElement('template');
        tpl.innerHTML = data.html.trim(); // server-rendered and escaped
        const li = tpl.content.firstElementChild;
        li.classList.add('is-new');
        listEl.prepend(li);
        heading.textContent = `${data.count} comment${data.count === 1 ? '' : 's'}`;
      }
      body.value = '';
    } catch (err) {
      status.className = 'notice';
      status.textContent = err.message;
    } finally { btn.disabled = false; }
  });
})();
