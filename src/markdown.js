// A small, safe Markdown subset. All text is HTML-escaped before formatting is applied,
// so authors (or a compromised admin account) cannot inject scripts.
import { escapeHtml } from './html.js';
import { getImage, picture } from './images.js';

const SAFE_URL = /^(https?:\/\/|\/(?!\/)|#|mailto:)/i;

function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const u = url.replace(/&amp;/g, '&');
    if (!SAFE_URL.test(u)) return label;
    const ext = /^https?:\/\//i.test(u);
    return `<a href="${escapeHtml(u)}"${ext ? ' rel="noopener nofollow" target="_blank"' : ''}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s;
}

function figure(alt, src, caption) {
  const m = src.match(/^image:(\d+)$/);
  if (m) {
    const img = getImage(Number(m[1]));
    if (!img) return '';
    const cap = caption || img.credit;
    return `<figure>${picture(img, { alt: alt || img.alt })}${cap ? `<figcaption>${inline(cap)}</figcaption>` : ''}</figure>`;
  }
  if (!/^\/uploads\//.test(src)) return ''; // only self-hosted images (CSP + privacy)
  return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">${caption ? `<figcaption>${inline(caption)}</figcaption>` : ''}</figure>`;
}

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/;

export function renderMarkdown(md) {
  const blocks = String(md || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const out = [];
  for (const block of blocks) {
    const b = block.trim();
    if (!b) continue;
    const lines = b.split('\n');
    let m;
    if ((m = b.match(/^(#{2,4})\s+(.+)$/)) && lines.length === 1) {
      const level = m[1].length;
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if ((m = b.match(IMAGE_LINE))) {
      out.push(figure(m[1], m[2], m[3]));
    } else if (lines.every((l) => /^>\s?/.test(l))) {
      out.push(`<blockquote><p>${lines.map((l) => inline(l.replace(/^>\s?/, ''))).join('<br>')}</p></blockquote>`);
    } else if (lines.every((l) => /^[-*]\s+/.test(l))) {
      out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`);
    } else if (lines.every((l) => /^\d+\.\s+/.test(l))) {
      out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`);
    } else if (b === '---') {
      out.push('<hr>');
    } else {
      out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}

/** Plain text version (for llms-full.txt, descriptions, word counts). */
export function markdownToText(md) {
  return String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** FAQ is stored as "Q: ...\nA: ..." pairs. */
export function parseFaq(text) {
  const out = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const q = line.match(/^\s*Q:\s*(.+)/i);
    const a = line.match(/^\s*A:\s*(.+)/i);
    if (q) { cur = { q: q[1].trim(), a: '' }; out.push(cur); }
    else if (a && cur) cur.a = a[1].trim();
    else if (cur && line.trim()) cur.a += (cur.a ? ' ' : '') + line.trim();
  }
  return out.filter((x) => x.q && x.a);
}
