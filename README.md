# ACME AI Daily

A tech intelligence feed for the software team, aggregating 23 vendor and press
RSS sources into a single newspaper-style page.

Live: https://husainacme.github.io/acmedaily/

## How the data flows

Feeds are **not** fetched by the browser. A scheduled GitHub Action gathers
everything server-side and publishes a static file:

```
.github/workflows/publish.yml   every 30 min
  └─ npm run feeds              scripts/fetch-feeds.mjs → public/feeds.json
      ├─ merge into .cache/archive.json   (rolling 21-day article archive)
      ├─ weekly summary if >7d old        (scripts/weekly-summary.mjs → Claude)
      └─ npm run build          vite → dist/ (feeds.json copied in)
          └─ force-push dist/ → gh-pages branch
```

The browser only ever loads `feeds.json`. That means no CORS proxy sits in the
request path, the page renders immediately, and the "Updated 14:32" readout in
the header reflects **when the data was actually gathered** — not when your tab
happened to ask.

### Freshness behaviour

| Signal | Meaning |
|---|---|
| Green pip, `Updated 14:32` | Data is current; `Next in 18m` counts down to the next scheduled run |
| Amber pip, `3h 20m old` | Nothing has been published for over 90 minutes — the schedule has slipped |
| Red pip, `Update failed` | This tab could not fetch `feeds.json`; the last loaded data stays on screen |

An open tab re-checks for a newer build every 5 minutes, when the tab regains
focus, and when the network comes back. A background re-check never resets your
scroll position or "Load more" progress; only the Refresh button does.

GitHub runs scheduled workflows on a best-effort basis and can delay them under
load, which is why staleness is flagged at 90 minutes rather than 30. GitHub
also disables schedules in repositories with no activity for 60 days.

## The weekly AI review

The band under the ticker is a once-a-week editorial summary written by Claude
(`claude-opus-5`) from the article archive, rendered with the themes it picked
and the articles behind each one.

### Setting the API key

The summary needs `ANTHROPIC_API_KEY`. Without it the build still succeeds — it
just publishes a clearly-badged placeholder instead of failing. Get a key at
<https://platform.claude.com> → API keys.

**For CI** (the scheduled workflow) — set it once as a repository secret:

```bash
gh secret set ANTHROPIC_API_KEY --repo HusainAcme/acmedaily
```

That prompts for the value, so the key never enters your shell history. The web
equivalent is Settings → Secrets and variables → Actions → New repository
secret. To rotate it later, run the same command again — it overwrites.

**For local runs** — copy the template and fill it in once:

```bash
cp .env.example .env
```

`npm run feeds` reads `.env` automatically (via Node's `--env-file-if-exists`),
so you only enter the key once. `.env` is gitignored; `.env.example` is the
committed template and must never hold a real key.

> This repository is public. The key belongs in exactly two places — the GitHub
> secret and your local `.env`. Never in a source file, a commit, or `feeds.json`.

Two properties are deliberate:

- **It regenerates only when the current summary is over 7 days old.** The feed
  rebuilds 48 times a day; summarising on every run would cost roughly 48× more
  for no benefit. Cost at weekly cadence is on the order of $1/month.
- **Every failure path is non-fatal.** A missing key, an API error, a refusal,
  or a truncated response all log and carry the previous summary forward. The
  summary can never take the site down.

The archive exists because a publisher's RSS feed only carries its most recent
items — The Verge's holds under a day. Summarising a single fetch would have
badly under-weighted the highest-volume sources, so runs accumulate into
`.cache/archive.json` instead.

Article text from the feeds is passed to the model as delimited, explicitly
untrusted data, and the system prompt instructs it to ignore any instructions
that appear inside that text.

## Local development

```bash
npm install
npm run feeds   # fetch sources → public/feeds.json (needs network, ~15s)
npm run dev
```

Then open http://localhost:5173/acmedaily/ — the `/acmedaily/` path matters,
it matches the `base` in `vite.config.js`.

Scraped `og:image` results are cached in `.cache/images.json` (gitignored) so
repeat runs only look at genuinely new articles. CI carries the same cache
between runs via `actions/cache`.

## Adding or changing a source

Edit `src/sources.js` — it is plain data, imported by both the browser app and
the Node prefetch script, so the two cannot drift apart. Fields:

```js
{ id, cat, label, short, url, color, bg, domain }
```

`cat` must be one of the `CATEGORIES` ids. `domain` drives the favicon. Set
`isHtml: true` only for sources scraped from HTML rather than RSS (currently
just Anthropic, which publishes no feed).

## Manual publish

`npm run deploy` runs `feeds → build → gh-pages`. Normally unnecessary — the
scheduled workflow handles it, and any push to `main` triggers a publish too.

## Known broken feeds

These three URLs are dead upstream and are reported in the yellow banner on the
page. They need replacement URLs, not a code fix:

| Source | Status |
|---|---|
| Microsoft AI (`blogs.microsoft.com/ai/feed/`) | `410 Gone` — permanently removed |
| Adobe (`blog.adobe.com/en/publish/feed.xml`) | `404` |
| Fortinet (`fortinet.com/blog/rss.xml`) | `404` |
