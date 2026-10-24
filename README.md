# Research module: Bright Data layers

The Bright Data side of the research pipeline: fetch a page as markdown, find official pages with search, and track every source's status (fetching → slow → found / empty / blocked / error) with one bounded retry.

Extraction, quote verification, and Apify aren't in here yet. They build on top of `fetchPage`'s markdown.

## What's here

| File | What it does |
|---|---|
| `lib/research/contract.ts` | The shared data contract (zod schemas + types). Safe for client code. |
| `lib/research/config.ts` | Reads env vars, server-only. Missing config throws. |
| `lib/research/brightdata.ts` | **Layer 1.** One POST to `api.brightdata.com/request`. Never throws for HTTP errors or timeouts. |
| `lib/research/classify.ts` | Maps a raw Bright Data response to found / empty / blocked / error, and whether to retry. |
| `lib/research/tracked.ts` | The status state machine: soft timeout → `slow`, hard timeout → cancel, max 2 attempts, ordered status updates. |
| `lib/research/fetchPage.ts` | **Layer 2.** Web Unlocker → markdown, with status tracking. |
| `lib/research/search.ts` | **Layer 3.** SERP API → official-domain hits, filtered in code. |
| `lib/research/index.ts` | Server-side entry point (`import "server-only"`). |
| `scripts/try-fetch.ts` | Fetch one page and watch its status change. Saves the markdown. |
| `scripts/try-search.ts` | Run one search and see which hits are official. |
| `scripts/break-things.ts` | Logs raw Bright Data responses for bad key, bad zone, 404, etc. |
| `tests/research/*.test.ts` | 61 tests using fakes, no network or credits. |

## Add it to the repo

1. Copy `lib/research/`, `scripts/`, and `tests/research/` into the Next.js repo root. If the repo uses `src/`, put `lib/` under `src/`; the scripts and tests use relative imports, so fix those two paths.
2. Install:
   ```bash
   npm install zod server-only
   npm install -D tsx
   ```
   Works with zod 3 or 4.
3. Add these to `package.json` scripts:
   ```json
   "research:fetch": "tsx --conditions=react-server --env-file=.env.local scripts/try-fetch.ts",
   "research:search": "tsx --conditions=react-server --env-file=.env.local scripts/try-search.ts",
   "research:break": "tsx --conditions=react-server --env-file=.env.local scripts/break-things.ts",
   "test:research": "tsx --conditions=react-server --test tests/research/*.test.ts"
   ```
   `--conditions=react-server` lets the `server-only` guard pass outside Next.js. Without it, importing a server file throws, which is the point.
4. Add to `.gitignore`: `.research-out/` (and check `.env.local` is already there).
5. Put this in `.env.local`:
   ```bash
   BRIGHTDATA_API_TOKEN=...          # BRIGHTDATA_API_KEY also works
   BRIGHTDATA_UNLOCKER_ZONE=web_unlocker1
   BRIGHTDATA_SERP_ZONE=serp_api1
   ```
6. Run `npm run test:research`. All 61 tests should pass.

## Tonight, in this order

1. **`npm run research:break`** prints the raw response for each failure case next to how `classify.ts` read it. If a row's classification looks wrong, fix the tables in `classify.ts` and add a case to `classify.test.ts`. The JSON log goes to `.research-out/`.
2. **`npm run research:fetch -- --find "60 days" --find '$85'`** fetches the SF Rec & Park special-event page, saves the markdown, and tells you whether each phrase is on the page. If they're missing, check whether the facts are in a linked PDF.
3. **`npm run research:fetch -- <url> --soft 1000`** should show `fetching → slow → found`.
4. **`npm run research:search`** should end `found` with sfrecpark.org or sf.gov hits. A nonsense query should end `empty`.

Two seed URLs to try: `https://sfrecpark.org/541/Special-Event-Application-Information` and `https://www.sf.gov/fees-for-outdoor-special-event-permitting`.

## Wiring it into the backend

`onStatus` gets a fresh copy of the source on every change. The backend passes a function that **upserts by `id`**; the frontend polls that table. Updates arrive one at a time and in order, and the final one is written before `fetchPage` returns.

```ts
import { checkResearchConfig, fetchPage, newSource, searchOfficialPages, type ResearchSource } from "@/lib/research";

export async function runOfficialResearch(eventId: string, save: (eventId: string, s: ResearchSource) => Promise<void>) {
  checkResearchConfig(); // throws on missing env before any rows exist
  const onStatus = (s: ResearchSource) => save(eventId, s);

  const { hits } = await searchOfficialPages("San Francisco park special event permit", onStatus);

  const sources = hits.map((h) => newSource({ url: h.url, provider: "bd_unlocker", sourceType: "official_city" }));
  await Promise.all(sources.map(onStatus)); // show them as "queued" right away

  const pages = await Promise.all(sources.map((s) => fetchPage(s, onStatus)));
  return pages; // pages[i].markdown goes to extraction (next step)
}
```

Client components import types from `@/lib/research/contract`, never from `@/lib/research`.

## How failures are classified

| Shows as | When | Retried? |
|---|---|---|
| `found` | Page came back with real content | — |
| `empty` | Page came back with under 100 characters, or a search had no allowed hits | No |
| `blocked` | CAPTCHA, blocking status, rate limit, site 429 | Once |
| `blocked` | Login wall (site 401/403), robots.txt, premium domain, Bright Data policy | No |
| `error` | Our hard timeout, network failure, Bright Data timeouts, site 5xx | Once |
| `error` | Bad key (401), bad zone (400), 404, bad certificate, host doesn't resolve | No |

This follows Bright Data's [Web Unlocker error catalog](https://docs.brightdata.com/products/web-unlocker/error-codes). `break-things` is how you confirm it with real responses.

## Knobs

| Env var | Default | Notes |
|---|---|---|
| `RESEARCH_SOFT_TIMEOUT_MS` | 8000 | When a source shows `slow` |
| `RESEARCH_HARD_TIMEOUT_MS` | 25000 | When an attempt is cancelled |
| `RESEARCH_RETRY_DELAY_MS` | 1000 | Pause before attempt 2 |

## Known limits

- **Hard timeout vs. slow sites.** Bright Data can wait 30–150 s on some pages before giving up, and the 25 s hard timeout cancels first. That's the right call for a live demo. If a specific page keeps timing out, raise the hard timeout and see whether it ever returns.
- **PDFs.** Markdown conversion is for HTML pages. If the permit facts live in a PDF, that's a separate fetch path.
- **The SERP zone has to be a SERP API zone.** If it isn't, search ends `error` with "wasn't JSON".
- **Not tested against live Bright Data yet.** The tests use fakes, so the first `research:break` run is the real check.
