// Writes a full draft article from a lead (a Web radar find or a reader tip) with OpenAI or the Claude API,
// then attaches a freely licensed cover photo from Wikimedia Commons. Everything is saved as a
// DRAFT: nothing goes live until an admin reads it and publishes.
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { ROOT } from './config.js';
import { db } from './db.js';
import { uniqueSlug } from './articles.js';
import { createImage } from './images.js';
import { findCoverImage } from './image-finder.js';
import { STORED } from './categories.js';

const MODEL = 'claude-opus-5-5';

// Read keys from .env each time, so pasting one in works without restarting the server.
const ENV_FILE = path.join(ROOT, '.env');
function envVar(name) {
  try {
    const m = fs.readFileSync(ENV_FILE, 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'\\s#]*)`, 'm'));
    if (m && m[1]) return m[1];
  } catch {}
  return process.env[name] || '';
}
const apiKey = () => envVar('ANTHROPIC_API_KEY');
/** OpenAI wins when its key is set; otherwise Claude. */
export const provider = () => (envVar('OPENAI_API_KEY') ? 'openai' : apiKey() ? 'claude' : null);
export const aiEnabled = () => Boolean(provider());

let client = null; let clientKey = '';
function getClient() {
  const key = apiKey();
  if (!client || key !== clientKey) {
    // Explicit base URL so a stray ANTHROPIC_BASE_URL in the shell can't redirect the site's key.
    client = new Anthropic({ apiKey: key, baseURL: process.env.CLAUDE_API_BASE_URL || 'https://api.anthropic.com', timeout: 10 * 60 * 1000 });
    clientKey = key;
  }
  return client;
}

let oa = null; let oaKey = '';
function getOpenAI() {
  const key = envVar('OPENAI_API_KEY');
  if (!oa || key !== oaKey) { oa = new OpenAI({ apiKey: key, baseURL: process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1', timeout: 10 * 60 * 1000 }); oaKey = key; }
  return oa;
}

// ---- Jobs (in memory: a restart simply forgets unfinished ones) ----
const jobs = new Map(); // key -> { state: 'writing'|'done'|'error', articleId?, error?, started }
export const jobFor = (key) => jobs.get(key);
export const anyWriting = () => [...jobs.values()].some((j) => j.state === 'writing');

const SYSTEM = `You write for "Rumors", a Toronto celebrity-sighting site. Every story is a first-person account from a regular Torontonian who saw (or nearly saw) a celebrity somewhere in the city. The site labels all stories as unverified rumours.

Voice and style:
- Sound like a real person telling a friend, not a journalist or a press release. Specific, a little funny, a little self-deprecating. Vary sentence length. Short paragraphs.
- Invent a narrator with a distinct personality and a pseudonym like "Priya S." or "Dave M." (first name + last initial). Give them a believable reason to be at the place.
- Never use the em dash or en dash characters. Use commas, periods or parentheses instead.
- No clichés like "little did I know", "in today's fast-paced world", "a testament to". No hashtags or emoji.
- 700 to 1000 words. Use 2 to 4 "## " subheadings. Markdown only (no HTML).
- Include real, accurate details about the venue and neighbourhood (what it is known for, the room, the menu, the street). Use web search to check them, and to check the celebrity's current Toronto connection (a shoot, tour date, game, festival) when there is one.
- End with a short section where the narrator admits what they are and aren't sure of.
- No links, URLs, source names in brackets or citations anywhere in the article. Mention an outlet in plain words only if it helps the story.

Safety rules (strict):
- Keep it harmless: what they ate, wore, how they treated staff, who they were with in general terms ("a few friends"). Never claim or hint at crimes, drug use, health issues, pregnancies, affairs, breakups, money trouble or anything that could damage someone's reputation, even if the source mentions it.
- Never name private individuals other than the made-up narrator and generic staff ("our server").
- If the lead is weak, keep the story clearly framed as "I think it was them".
- Facts about the venue must be real. If you can't confirm a detail, leave it out.

FAQ: 3 or 4 questions a searcher might ask (for example "Has <celebrity> been to <venue>?", "Where is <venue>?", "What is <venue> known for?"), each with a 1 to 3 sentence answer that is honest about the sighting being unconfirmed.

When you are done researching, call the save_article tool exactly once with the finished article. Do not write the article as plain text.`;

const ARTICLE_TOOL = {
  name: 'save_article',
  description: 'Save the finished article as a draft on the site. Call this exactly once, after any research, with every field filled in.',
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'excerpt', 'body', 'author_name', 'celebrities', 'location_name', 'location_address', 'neighbourhood', 'tags', 'categories', 'faq', 'meta_title', 'meta_description', 'image_alt'],
    properties: {
      title: { type: 'string', description: 'Headline in the narrator\'s voice, 50 to 110 characters, naming the celebrity and the venue.' },
      excerpt: { type: 'string', description: 'One or two sentences (max 240 characters) that hook the reader, in the narrator\'s voice.' },
      body: { type: 'string', description: 'The full article in Markdown, 700 to 1000 words, with 2 to 4 "## " subheadings.' },
      author_name: { type: 'string', description: 'Narrator pseudonym, first name + last initial, e.g. "Priya S."' },
      celebrities: { type: 'array', items: { type: 'string' }, description: 'Full names of the celebrities in the story.' },
      location_name: { type: 'string', description: 'Venue name exactly as the business writes it.' },
      location_address: { type: 'string', description: 'Full street address, e.g. "120 Avenue Rd, Toronto, ON M5R 2H4". Empty string if not confirmed.' },
      neighbourhood: { type: 'string', description: 'Toronto neighbourhood, e.g. "Yorkville", "King West".' },
      tags: { type: 'array', items: { type: 'string' }, description: '3 to 6 topic tags in Title Case, e.g. "Restaurants", "Music", "Nightlife", "Film", "Influencers", "Sports".' },
      categories: { type: 'array', items: { type: 'string', enum: STORED.map((c) => c.slug) }, description: 'Site sections this story belongs in.' },
      faq: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['q', 'a'], properties: { q: { type: 'string' }, a: { type: 'string' } } } },
      meta_title: { type: 'string', description: 'SEO title, max 60 characters.' },
      meta_description: { type: 'string', description: 'SEO description, 120 to 155 characters.' },
      image_alt: { type: 'string', description: 'Short alt text for a photo of the celebrity, e.g. "Oscar Isaac at a film premiere".' },
    },
  },
};

const isStr = (v) => typeof v === 'string';
const isStrArr = (v) => Array.isArray(v) && v.every(isStr);
function validate(input) {
  const req = ARTICLE_TOOL.input_schema.required;
  if (!input || typeof input !== 'object') return 'no article returned';
  for (const k of req) if (input[k] === undefined) return `missing ${k}`;
  for (const k of ['title', 'excerpt', 'body', 'author_name', 'location_name', 'location_address', 'neighbourhood', 'meta_title', 'meta_description', 'image_alt']) if (!isStr(input[k])) return `bad ${k}`;
  for (const k of ['celebrities', 'tags', 'categories']) if (!isStrArr(input[k])) return `bad ${k}`;
  if (!Array.isArray(input.faq) || !input.faq.every((f) => f && isStr(f.q) && isStr(f.a))) return 'bad faq';
  if (input.body.trim().split(/\s+/).length < 300) return 'article too short';
  return null;
}

// No em/en dashes anywhere (house style), and no stray HTML.
// Web search adds source citations like " ([site.com](https://…))": a first-person story shouldn't carry them.
export const stripCitations = (s) => String(s)
  .replace(/\s*\(\[[^\]]*\]\(https?:[^)]*\)\)/g, '')
  .replace(/\[([^\]]+)\]\(https?:[^)]*utm_source=[^)]*\)/g, '$1')
  .replace(/[ \t]+\n/g, '\n');
const clean = (s, max) => stripCitations(s).replace(/\s*[—–]\s*/g, ', ').replace(/<[^>]+>/g, '').replace(/ ,/g, ',').trim().slice(0, max);

function leadPrompt(lead) {
  const lines = ['Write a Rumors article from this lead.', ''];
  if (lead.kind === 'radar') {
    lines.push('Source: a news item found online. Use it only as the starting point: write an original first-person story, never copy its wording.');
    lines.push(`Headline: ${lead.title}`, `Outlet: ${lead.source || 'unknown'}`, `Link: ${lead.url}`);
    if (lead.published_at) lines.push(`Published: ${lead.published_at}`);
    if (lead.snippet) lines.push(`Snippet: ${lead.snippet}`);
  } else {
    lines.push('Source: a tip a reader sent us. Keep their details (what they saw, when, where) and tell it in the first person, as if the reader wrote it. Keep their name as the author if they gave one.');
    if (lead.reporter) lines.push(`Reader name: ${lead.reporter}`);
    if (lead.seen_when) lines.push(`When: ${lead.seen_when}`);
    lines.push(`Their story: ${lead.story || '(sent as a voice note, no text; write a short, cautious account from the details below)'}`);
  }
  if (lead.celebrity) lines.push(`Celebrity: ${lead.celebrity}`);
  if (lead.place) lines.push(`Place: ${lead.place}`);
  if (lead.address) lines.push(`Address: ${lead.address}`);
  lines.push('', `Today is ${new Date().toDateString()}. The narrator saw this in the last few days.`);
  return lines.join('\n');
}

async function callClaude(lead) {
  const messages = [{ role: 'user', content: leadPrompt(lead) }];
  for (let turn = 0; turn < 6; turn++) {
    const stream = getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: SYSTEM,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6, user_location: { type: 'approximate', city: 'Toronto', region: 'Ontario', country: 'CA', timezone: 'America/Toronto' } }, ARTICLE_TOOL],
      tool_choice: { type: 'auto' },
      messages,
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('Claude declined to write this one.');
    if (msg.stop_reason === 'max_tokens') throw new Error('The article ran too long. Try again.');
    const call = msg.content.find((b) => b.type === 'tool_use' && b.name === 'save_article');
    if (call) {
      const problem = validate(call.input);
      if (!problem) return call.input;
      messages.push({ role: 'assistant', content: msg.content });
      messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: `The article was not saved: ${problem}. Call save_article again with every field complete.` }] });
      continue;
    }
    messages.push({ role: 'assistant', content: msg.content });
    if (msg.stop_reason !== 'pause_turn') messages.push({ role: 'user', content: 'Please call save_article now with the finished article.' });
  }
  throw new Error('Claude did not return an article.');
}

// OpenAI: Responses API with web search and a strict JSON schema for the article.
async function callOpenAI(lead) {
  const model = envVar('OPENAI_MODEL') || 'gpt-5';
  const instructions = SYSTEM.replace('When you are done researching, call the save_article tool exactly once with the finished article. Do not write the article as plain text.', 'When you are done researching, reply with the finished article as JSON matching the schema.');
  const format = { type: 'json_schema', name: 'article', strict: true, schema: ARTICLE_TOOL.input_schema };
  let input = leadPrompt(lead);
  for (const tools of [[{ type: 'web_search' }], [{ type: 'web_search_preview' }], []]) {
    let res;
    try {
      res = await getOpenAI().responses.create({ model, instructions, input, tools, text: { format } });
    } catch (e) {
      // Some models/accounts don't support a search tool: try the next option.
      if (e instanceof OpenAI.BadRequestError && tools.length && /tool|web_search/i.test(e.message)) continue;
      throw e;
    }
    let article;
    try { article = JSON.parse(res.output_text); } catch { throw new Error('OpenAI returned an article that could not be read. Try again.'); }
    const problem = validate(article);
    if (!problem) return article;
    if (problem === 'article too short') { input = `${leadPrompt(lead)}\n\nImportant: the body must be at least 700 words.`; continue; }
    throw new Error(`OpenAI returned an incomplete article (${problem}). Try again.`);
  }
  throw new Error('OpenAI did not return an article.');
}

function insertDraft(a, lead, coverId) {
  const faq = a.faq.slice(0, 6).map((f) => `Q: ${clean(f.q, 200)}\nA: ${clean(f.a, 600)}`).join('\n\n');
  const celebs = a.celebrities.map((c) => clean(c, 80)).filter(Boolean).slice(0, 6);
  const cats = a.categories.filter((s) => STORED.some((c) => c.slug === s));
  const body = stripCitations(a.body).replace(/\s*[—–]\s*/g, ', ').replace(/ ,/g, ',').trim();
  const info = db.prepare(`INSERT INTO articles (slug, title, excerpt, body, cover_image_id, location_name, location_address, neighbourhood,
      celebrities, tags, categories, faq, meta_title, meta_description, author_name, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft')`).run(
    uniqueSlug(`${celebs[0] || 'celebrity'} ${a.location_name || 'toronto'}`), clean(a.title, 160), clean(a.excerpt, 300), body.slice(0, 60000), coverId,
    clean(a.location_name, 120), clean(a.location_address, 200), clean(a.neighbourhood, 80), celebs.join(', '),
    a.tags.map((t) => clean(t, 40)).filter(Boolean).slice(0, 8).join(', '), cats.join(', '), faq,
    clean(a.meta_title, 70), clean(a.meta_description, 170), clean(lead.reporter || a.author_name, 60) || 'Rumors Toronto');
  return Number(info.lastInsertRowid);
}

/**
 * Start writing in the background. `onDone(articleId)` links the draft back to its lead.
 * `existingCoverId` (e.g. a reader's photo) skips the image search.
 */
export function startDraft(key, lead, { onDone, onError, existingCoverId = null } = {}) {
  if (jobs.get(key)?.state === 'writing') return;
  jobs.set(key, { state: 'writing', started: Date.now() });
  (async () => {
    const article = provider() === 'openai' ? await callOpenAI(lead) : await callClaude(lead);
    let coverId = existingCoverId;
    if (!coverId) {
      try {
        const found = await findCoverImage({ celebrities: article.celebrities, place: article.location_name, neighbourhood: article.neighbourhood });
        if (found) coverId = (await createImage(found.buffer, { originalName: found.fileName, alt: clean(found.isPerson ? article.image_alt : `${article.location_name || found.subject}, Toronto`, 300), credit: found.credit })).id;
      } catch (e) { console.warn('Cover search failed:', e.message); }
    }
    const id = insertDraft(article, lead, coverId);
    onDone?.(id);
    jobs.set(key, { state: 'done', articleId: id });
  })().catch((e) => {
    const msg = e instanceof OpenAI.AuthenticationError ? 'Your OpenAI API key was rejected. Check OPENAI_API_KEY in .env.'
      : e instanceof OpenAI.RateLimitError ? `OpenAI says: ${e.message}`.slice(0, 300)
      : e instanceof OpenAI.NotFoundError ? `OpenAI model not available to your account. Change OPENAI_MODEL in .env. (${e.message})`.slice(0, 300)
      : e instanceof OpenAI.APIError ? `OpenAI error ${e.status ?? ''}: ${e.message}`.slice(0, 300)
      : e instanceof Anthropic.AuthenticationError ? 'Your Claude API key was rejected. Check ANTHROPIC_API_KEY in .env.'
      : e instanceof Anthropic.RateLimitError ? 'Claude API rate limit reached. Try again in a minute.'
      : e instanceof Anthropic.APIError ? `Claude API error ${e.status ?? ''}: ${e.message}`.slice(0, 300)
      : String(e.message || e).slice(0, 300);
    console.error('AI draft failed:', e);
    jobs.set(key, { state: 'error', error: msg });
    onError?.(msg);
  });
}
