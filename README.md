# Rumors — Toronto celebrity sightings

A fast, server-rendered site with a built-in admin. Node.js (22.13+), Express, SQLite (built into Node), Sharp for images. No front-end framework.

## Run locally

```bash
npm install
npm run seed        # 10 starter articles with placeholder cover art (safe to re-run)
npm run dev         # http://localhost:3000  ·  admin at /admin
```

The first admin is created from `ADMIN_USER` / `ADMIN_PASSWORD` in `.env` (min 12 chars). To add or reset one later: `npm run create-admin -- <username>`.

## What's where

| Path | Purpose |
|---|---|
| `/` | Homepage: #1 story, trending list, celebrity chips, latest, most discussed |
| `/rumor/:slug` | Article + comments (also `/rumor/:slug.md` for AI tools) |
| `/tag/:slug` | Auto-generated celebrity / topic landing pages ("Drake spotted in Toronto") |
| `/admin` | Articles (ranked), editor, image library, comment moderation |
| `/sitemap.xml`, `/feed.xml`, `/robots.txt`, `/llms.txt`, `/llms-full.txt` | Search & AI discovery |

## Ranking

- **Read** = the article tab was visible for 10+ seconds. Enforced on the server too: the page carries a signed timestamp and pings sent sooner are ignored. One read per visitor per article per day; bots are skipped. No raw IPs are stored.
- **Score** = (reads + comments × 5 + 1) ÷ (hours since publishing + 2)^1.5, ×1.25 if ★ featured. Tune in `src/config.js`.

## Web radar (admin → Web radar)

Once a day, after 6 a.m. Toronto time, the server searches Google News and Toronto outlets (Daily Hive, Narcity) for celebrity sightings and rumours in Toronto. It scores each result for relevance and groups duplicate coverage, then files the finds under the seven questions it tracks. Use **Scan now** for an extra run, and edit the celebrity and place watchlists at the bottom of the tab. Only headlines, short snippets and links are stored. Treat finds as leads and write stories in your own words. If you run more than one server, set `RADAR_DISABLED=true` on all but one.

## AI drafts (OpenAI or Claude)

Put `OPENAI_API_KEY=` (model set by `OPENAI_MODEL`, default `gpt-5`) or `ANTHROPIC_API_KEY=` in `.env`; no restart needed, and OpenAI is used when both are set. Then **Create draft** on a Web radar find (and **Approve** on a reader tip) asks the AI (with web search) to research the lead and write a full first-person article: title, excerpt, body, venue address, neighbourhood, tags, categories, FAQ and SEO fields. It runs in the background (1 to 3 minutes) and the page refreshes itself. A cover photo is picked automatically from **Wikimedia Commons**, only from freely licensed files (CC0, CC BY, CC BY-SA, public domain), and the required credit is saved as the caption. Reader tip photos are kept as the cover. Drafts are never published automatically.

## Deploying

Run behind HTTPS (Nginx, Caddy, Render, Fly.io, a VPS…). Set in the environment:

```
NODE_ENV=production
SITE_URL=https://www.your-domain.ca
TRUST_PROXY=true
APP_SECRET=<64+ random characters>
```

Keep `data/` (database) and `uploads/` (images) on persistent storage and back them up.

After launch: submit the sitemap in **Google Search Console** and **Bing Webmaster Tools** (Bing's index also feeds ChatGPT search and Copilot), and optionally set `INDEXNOW_KEY`.

## Security notes

CSP with nonces, no inline scripts, HSTS in production, scrypt passwords, HttpOnly/SameSite=Strict session cookies, CSRF tokens on every admin action, login and comment rate limits, all SQL parameterised, every upload re-encoded by Sharp (EXIF/GPS stripped), and article Markdown escaped before formatting.
