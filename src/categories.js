// Site sections. Each article stores its categories (chosen in the editor). When none are
// chosen, they are worked out from the article's tags and location. "Toronto Trending" is
// never stored: it is always the articles readers are engaging with most right now.
import { db } from './db.js';
import { list } from './html.js';

export const CATEGORIES = [
  {
    slug: 'celebrity-sightings', name: 'Celebrity Sightings', description: 'Where celebrities were spotted around Toronto.',
    seoTitle: 'Celebrity Sightings in Toronto: Where Stars Were Spotted',
    intro: 'Every first-hand report of a celebrity spotted around Toronto, from Yorkville dining rooms to King West rooftops.',
    auto: (a) => list(a.celebrities).length > 0,
  },
  {
    slug: 'hot-spots', name: 'Hot Spots', description: 'Restaurants, bars, hotels and clubs celebrities visit.',
    seoTitle: 'Toronto Celebrity Hot Spots: Restaurants, Bars & Hotels Stars Visit',
    intro: 'The Toronto restaurants, bars, hotels and clubs where celebrities have been seen eating, drinking and hanging out.',
    auto: (a) => /\b(restaurants?|bars?|steakhouse|fine dining|rooftops?|hotels?|clubs?|lounges?|brunch|thai food|indian food|mexican food|greek food|seafood)\b/i.test(`${a.tags} ${a.location_name}`),
  },
  {
    slug: 'entertainment', name: 'Entertainment', description: 'TIFF, concerts, premieres and celebrity events.',
    seoTitle: 'Toronto Entertainment News: TIFF, Concerts, Premieres & Celebrity Events',
    intro: 'Film stars, musicians and athletes in Toronto: TIFF, concerts, premieres, games and celebrity events.',
    auto: (a) => /\b(tiff|music|film|films|film shoots|hollywood|hollywood in toronto|concerts?|premieres?|events?|awards|sports|nba|mlb|nhl|blue jays|raptors)\b/i.test(a.tags),
  },
  {
    slug: 'influencers', name: 'Influencers', description: 'Toronto creators, personalities and trending stories.',
    seoTitle: 'Toronto Influencers & Creators: Sightings and Stories',
    intro: 'Creators, social media personalities and the internet-famous, spotted around Toronto.',
    auto: (a) => /\b(influencers?|creators?|youtube|tiktok|instagram|social media|podcast)\b/i.test(a.tags),
  },
  {
    slug: 'toronto-trending', name: 'Toronto Trending', description: 'Stories and conversations people are following.',
    seoTitle: 'Trending in Toronto: The Celebrity Stories Everyone Is Talking About',
    intro: 'The rumours Toronto is reading and talking about most right now, ranked live by reads and comments.',
    dynamic: true,
  },
  {
    slug: 'nightlife', name: 'Nightlife', description: 'Parties, openings, venues and nightlife news.',
    seoTitle: 'Toronto Nightlife: Celebrity Parties, Bars, Clubs & Late-Night Sightings',
    intro: 'Late nights, parties, rooftops, lounges and clubs: where Toronto’s famous faces go after dark.',
    auto: (a) => /\b(nightlife|bars?|rooftops?|clubs?|lounges?|parties|party|late night|openings?)\b/i.test(`${a.tags} ${a.location_name}`),
  },
];

export const STORED = CATEGORIES.filter((c) => !c.dynamic);
export const bySlug = (slug) => CATEGORIES.find((c) => c.slug === slug);
const TRENDING_SIZE = 8;

// Add the column on existing databases.
if (!db.prepare('PRAGMA table_info(articles)').all().some((c) => c.name === 'categories')) {
  db.exec("ALTER TABLE articles ADD COLUMN categories TEXT NOT NULL DEFAULT ''");
}

export const autoCategories = (a) => STORED.filter((c) => c.auto(a)).map((c) => c.slug);

/** Categories for an article: what the editor chose, or the automatic ones. */
export function categoriesOf(a, trendingIds = null) {
  const chosen = list(a.categories).filter((s) => STORED.some((c) => c.slug === s));
  const slugs = chosen.length ? chosen : autoCategories(a);
  if (trendingIds?.has(a.id)) slugs.push('toronto-trending');
  return slugs;
}

/** Articles in a category, in live ranking order. `ranked` comes from rankedArticles(). */
export function articlesIn(slug, ranked) {
  const trendingIds = new Set(trendingTop(ranked).map((a) => a.id));
  if (slug === 'toronto-trending') return trendingTop(ranked);
  return ranked.trending.filter((a) => categoriesOf(a, trendingIds).includes(slug));
}

export function trendingTop(ranked) {
  return ranked.trending.slice(0, TRENDING_SIZE);
}

/** Every category with its articles, for the homepage section and navigation. */
export function categoryOverview(ranked) {
  return CATEGORIES.map((c) => ({ ...c, articles: articlesIn(c.slug, ranked) }));
}
