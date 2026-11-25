import { db } from './db.js';
import { config } from './config.js';
import { list, slugify } from './html.js';

/**
 * Engagement score.
 *  - engagement = qualified views (10s+ on page, one per visitor per day) + comments × commentWeight
 *  - trending   = engagement decayed by age, so fresh rumours with momentum rise to the top
 */
export function engagement(a) {
  return a.views + a.comments_count * config.commentWeight;
}
export function trendingScore(a, now = Date.now()) {
  const hours = Math.max(0, (now - new Date(a.published_at).getTime()) / 36e5);
  const featuredBoost = a.featured ? 1.25 : 1;
  return ((engagement(a) + 1) * featuredBoost) / Math.pow(hours + 2, config.gravity);
}

const PUBLISHED = `status = 'published' AND published_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

export function publishedArticles() {
  return db.prepare(`SELECT * FROM articles WHERE ${PUBLISHED} ORDER BY published_at DESC`).all();
}

/** All published articles with rank info attached. */
export function rankedArticles() {
  const now = Date.now();
  const all = publishedArticles().map((a) => ({ ...a, engagement: engagement(a), score: trendingScore(a, now) }));
  const trending = [...all].sort((x, y) => y.score - x.score);
  trending.forEach((a, i) => { a.rank = i + 1; });
  return {
    all,
    trending,
    popular: [...all].sort((x, y) => y.engagement - x.engagement || y.views - x.views),
    discussed: all.filter((a) => a.comments_count > 0).sort((x, y) => y.comments_count - x.comments_count),
    latest: all,
  };
}

export const getPublishedBySlug = (slug) =>
  db.prepare(`SELECT * FROM articles WHERE slug = ? AND ${PUBLISHED}`).get(slug);

export function celebrityIndex(articles) {
  const map = new Map();
  for (const a of articles) {
    for (const name of list(a.celebrities)) {
      const key = slugify(name);
      const e = map.get(key) || { name, slug: key, count: 0, engagement: 0 };
      e.count++; e.engagement += a.engagement ?? engagement(a);
      map.set(key, e);
    }
  }
  return [...map.values()].sort((x, y) => y.engagement - x.engagement || y.count - x.count);
}

export function articlesForTag(articles, tagSlug) {
  return articles.filter((a) =>
    [...list(a.celebrities), ...list(a.tags), a.neighbourhood].some((t) => slugify(t) === tagSlug));
}

export function tagLabel(articles, tagSlug) {
  for (const a of articles) {
    for (const t of [...list(a.celebrities), ...list(a.tags), a.neighbourhood]) if (slugify(t) === tagSlug) return t;
  }
  return null;
}

export function uniqueSlug(base, excludeId = 0) {
  let slug = slugify(base) || 'rumor';
  let n = 1;
  while (db.prepare('SELECT 1 FROM articles WHERE slug = ? AND id != ?').get(slug, excludeId)) slug = `${slugify(base)}-${++n}`;
  return slug;
}
