import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, n, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, { ...SCRYPT, N: Number(n) });
  return crypto.timingSafeEqual(key, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const hmac = (s) => crypto.createHmac('sha256', config.secret).update(s).digest('base64url');
export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Anonymous, daily-rotating visitor fingerprint. Raw IPs are never stored. */
export function visitorId(req) {
  const day = new Date().toISOString().slice(0, 10);
  return hmac(`${day}|${req.ip}|${req.get('user-agent') || ''}`).slice(0, 32);
}

/** Signed, timestamped token: proves the page was served by us and when. */
export function signToken(purpose, id) {
  const ts = Date.now();
  return `${id}.${ts}.${hmac(`${purpose}|${id}|${ts}`)}`;
}
export function readToken(purpose, token) {
  const [id, ts, sig] = String(token || '').split('.');
  if (!id || !ts || !sig || !safeEqual(sig, hmac(`${purpose}|${id}|${ts}`))) return null;
  return { id: Number(id), ageMs: Date.now() - Number(ts) };
}

// ---------- Sessions (admin only) ----------
const COOKIE = config.isProd ? '__Host-rumors_sid' : 'rumors_sid';
const SESSION_TTL = 1000 * 60 * 60 * 12; // 12 hours

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
    }
  }
  return out;
}

function setCookie(res, value, maxAgeMs) {
  const attrs = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (config.isProd) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

export function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (id_hash, user_id, csrf, expires_at) VALUES (?,?,?,?)')
    .run(sha256(token), userId, csrf, Date.now() + SESSION_TTL);
  setCookie(res, token, SESSION_TTL);
}

export function destroySession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(token));
  setCookie(res, '', 0);
}

export function loadSession(req, _res, next) {
  const token = parseCookies(req)[COOKIE];
  if (token) {
    const row = db.prepare(`SELECT s.csrf, s.expires_at, u.id, u.username FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`).get(sha256(token));
    if (row && row.expires_at > Date.now()) req.admin = { id: row.id, username: row.username, csrf: row.csrf };
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (req.admin) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not signed in' });
  res.redirect(303, '/admin/login');
}

/** CSRF: every state-changing admin request must carry the session's token. */
export function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = req.get('x-csrf-token') || req.body?._csrf;
  if (req.admin && sent && safeEqual(sent, req.admin.csrf)) return next();
  res.status(403).send('Invalid or missing security token. Reload the page and try again.');
}

/** Reject cross-site POSTs to public endpoints. */
export function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin && origin !== 'null') {
    try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin request rejected' }); }
    catch { return res.status(403).json({ error: 'Bad origin' }); }
  }
  next();
}

// ---------- Rate limiting (in-memory, per IP) ----------
export function rateLimit({ windowMs, max, message = 'Too many requests. Please slow down.' }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    let h = hits.get(req.ip);
    if (!h || h.reset < now) { h = { count: 0, reset: now + windowMs }; hits.set(req.ip, h); }
    if (++h.count > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).type('text/plain').send(message);
    }
    next();
  };
}

// ---------- Security headers ----------
export function securityHeaders(req, res, next) {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      `script-src 'self' 'nonce-${res.locals.nonce}'`,
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      ...(config.isProd ? ['upgrade-insecure-requests'] : []),
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), browsing-topics=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  if (config.isProd) res.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  next();
}

export const BOT_UA = /bot|crawl|spider|slurp|preview|headless|lighthouse|python-requests|curl|wget|httpclient|monitor/i;
