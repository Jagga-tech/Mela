# Research module: Bright Data layers

The Bright Data side of the research pipeline: fetch a page as markdown, find official pages with search, and track every source's status (fetching → slow → found / empty / blocked / error) with one bounded retry.

Also here: LLM extraction (`extract.ts`), quote verification (`verify.ts`), Apify vendor discovery (`apify.ts`), the orchestrator that ties it together (`pipeline.ts`), a cache of real results (`cache.ts`), and SF park discovery from DataSF (`opendata.ts`).

## What's here

| File | What it does |
|---|---|
| `src/lib/research/contract.ts` | The shared data contract (zod schemas + types). Safe for client code. |
| `src/lib/research/config.ts` | Reads env vars, server-only. Missing config throws. |
| `src/lib/research/brightdata.ts` | **Layer 1.** One POST to `api.brightdata.com/request`. Never throws for HTTP errors or timeouts. |
| `src/lib/research/classify.ts` | Maps a raw Bright Data response to found / empty / blocked / error, and whether to retry. |
| `src/lib/research/tracked.ts` | The status state machine: soft timeout → `slow`, hard timeout → cancel, max 2 attempts, ordered status updates. |
| `src/lib/research/fetchPage.ts` | **Layer 2.** Web Unlocker → markdown, with status tracking. |
| `src/lib/research/search.ts` | **Layer 3.** SERP API → official-domain hits, filtered in code. |
| `src/lib/research/extract.ts` | Claude (`claude-opus-5-5`, structured output) → one value + verbatim quote per field. Never trusted on its own. |
| `src/lib/research/apify.ts` | `compass/crawler-google-places` → `Vendor` records with their public listing URL. |
| `src/lib/research/pipeline.ts` | `runResearch`: queue every source, then fetch → extract → verify per page, with Apify alongside. Returns `ResearchResult`. |
| `src/lib/research/verify.ts` | Checks an extracted value against its quote and the page: `verified` (exact / derived) or `unknown` with a reason. |
| `src/lib/research/cache.ts` | Stores real `found` results with their original `fetchedAt`. Hits are labeled `fromCache`. |
| `src/lib/research/opendata.ts` | SF Rec & Park property list from DataSF (direct fetch, provider `open_data`). |
| `src/lib/research/index.ts` | Server-side entry point (`import "server-only"`). |
| `scripts/try-fetch.ts` | Fetch one page and watch its status change. Saves the markdown. |
| `scripts/try-search.ts` | Run one search and see which hits are official. |
| `scripts/break-things.ts` | Logs raw Bright Data responses for bad key, bad zone, 404, etc. |
| `scripts/try-parks.ts` | List SF parks from DataSF. No keys needed. |
| `scripts/try-research.ts` | The whole pipeline on real pages. Prints the status timeline and a facts table. |
| `tests/research/*.test.ts` | 131 tests using fakes, no network or credits. |

## How the app uses it

`POST /api/research {brief}` (`src/app/api/research/route.ts`) starts a job and returns at once; the page polls `GET /api/research/:jobId`, and `DELETE` cancels.

| File | Role |
|---|---|
| `src/lib/research/job.ts` | One job per confirmed brief. Venues: seed URLs (`data/research-seeds.json`) plus one SERP search for venue sites, directory and `.gov` sites filtered out in code, one page per domain, at most 4. Caterers: Apify near the brief's city, each caterer's own website, at most 3. Every page goes fetch → extract → verify. At most 10 sources. |
| `src/lib/research/snapshot.ts` | Maps a job into the web app's `ResearchSnapshot` (`src/mela/contracts.ts`): dollars → cents, price wording → `qualifier` (in code), cached rows labeled with their age. |
| `src/lib/research/jobStore.ts` | Jobs in this process's memory (`getJob`, `listJobs`). Finance and calls read vendors and facts from here, so run one long-lived server (`npm start`). |

## Calibration scripts

1. **`npm run research:break`** prints the raw response for each failure case next to how `classify.ts` read it. The JSON log goes to `.research-out/`.
2. **`npm run research:fetch -- <url> --find "capacity"`** fetches one page, saves the markdown, and says whether each phrase is on it. Add `--soft 1000` to see `fetching → slow → found`.
3. **`npm run research:search`** should end `found`; a nonsense query should end `empty`.

## Running the whole pipeline

```bash
npm run research:run -- --url <venue page> --name "<venue name>" --vendor "quinceañera caterer"
```

Each source row goes `queued → fetching (→ slow) → extracting → found | partial`, or ends `error` / `blocked` / `empty`. `partial` means the page was read but some fields are unknown; the row's `error` says how many. The full `ResearchResult` is saved to `.research-out/`.

Run it once with `--fresh` and a bad Bright Data key: that's the ablation test. Every fact must come back `unknown` / `source_failed`. (`pipeline.test.ts` checks the same thing offline.)

## How failures are classified

| Shows as | When | Retried? |
|---|---|---|
| `found` | Page came back with real content | — |
| `empty` | Page came back with under 100 characters, or a search had no allowed hits | No |
| `blocked` | CAPTCHA, blocking status, rate limit, site 429 | Once |
| `blocked` | Login wall (site 401/403), robots.txt, premium domain, Bright Data policy (incl. `proxy_error` "classified as Government") | No |
| `error` | Our hard timeout, network failure, Bright Data timeouts, site 5xx | Once |
| `error` | Bad key (401), bad zone (400), 404, bad certificate, host doesn't resolve | No |

This follows Bright Data's [Web Unlocker error catalog](https://docs.brightdata.com/products/web-unlocker/error-codes). `break-things` is how you confirm it with real responses.

## Cache

Real calls go through a file cache in `.research-cache/` (gitignored), so a rehearsed query answers in milliseconds and a new query goes live.

- Only `found` results are stored. Failures always run live again.
- A hit keeps the original `fetchedAt`, has `fromCache: true`, and `attempt: 0`. The dashboard should show that it's cached and how old it is.
- Scripts take `--fresh` to skip it. Code passes `cache: false`.
- **The ablation test must run with `RESEARCH_CACHE=off`.** With the cache on, a bad key still returns the cached shortlist, which is exactly what the test is meant to catch.
- Warm it before recording by running the demo scenario once.

## Verification

`verifyFact(markdown, candidate, sourceId)` decides, in code:

| Result | When |
|---|---|
| `unknown` / `not_on_page` | no quote or no value |
| `unknown` / `invalid_value` | wrong type for the field (e.g. `"lots"` for capacity) |
| `unknown` / `quote_mismatch` | the quote isn't on the page after normalizing |
| `verified` / `exact` | the value appears literally in the quote |
| `verified` / `derived` | words → number, a number picked from a range, any boolean, a catering category |

`failedSourceFacts` and `fillMissingFields` produce the `source_failed` and `not_on_page` rows, so every field has a state.

## Extraction

`extractFacts` sends the page markdown to Claude with a fixed schema (one `{ field, value, quote }` per field, `null` when the page doesn't say). Then `verifyFact` checks each quote against the page in code. The model never sets `confidence` or `state`.

- Model `claude-opus-5-5` at `effort: "low"`, with server-side refusal fallback enabled (`fallbacks: "default"`). Override the model with `RESEARCH_LLM_MODEL`.
- At most 2 attempts (SDK `maxRetries: 1`), 60 s timeout each.
- Pages over 400k characters are reported as an error, never truncated.
- Results are cached by a hash of the page text, so a cached page also skips the model. Bump `PROMPT_VERSION` in `extract.ts` when you change the prompt.
- The prompt tells the model to treat page content as data, but verification is the real guard: an injected "value" still needs a quote that's literally on the page.

## Knobs

| Env var | Default | Notes |
|---|---|---|
| `RESEARCH_SOFT_TIMEOUT_MS` | 8000 | When a source shows `slow` |
| `RESEARCH_HARD_TIMEOUT_MS` | 25000 | When an attempt is cancelled |
| `RESEARCH_RETRY_DELAY_MS` | 1000 | Pause before attempt 2 |
| `RESEARCH_CACHE` | on | `off` for the ablation test |
| `RESEARCH_CACHE_DIR` | .research-cache | Where cache files go |
| `RESEARCH_CACHE_TTL_MS` | 86400000 (24 h) | Older entries are fetched live again |
| `RESEARCH_LLM_MODEL` | claude-opus-5-5 | Extraction model |
| `RESEARCH_EXTRACT_TIMEOUT_MS` | 60000 | Per extraction attempt |

## Known limits

- **Bright Data blocks government domains.** sfrecpark.org returns `proxy_error` "classified as Government" (now shown as `blocked`). Park *rules* (fees, lead time, alcohol) need another path: ask Bright Data staff about access, or agree as a team on a labeled direct fetch.
- **DataSF's park list is from 2016.** It's good for names and locations, not rules.
- **The file cache needs a writable disk.** On Vercel it defaults to `/tmp/research-cache`, which is per-instance and short-lived, so a cold start may miss. For a reliable warm cache in the demo, swap in a database-backed `ResearchCache` (two methods: `get`, `set`) or run the demo from a long-lived server.
- **Apify runs take 30–90 s.** The source shows `slow` after 30 s and is cancelled (and the Actor run aborted) at 150 s.

- **Hard timeout vs. slow sites.** Bright Data can wait 30–150 s on some pages before giving up, and the 25 s hard timeout cancels first. That's the right call for a live demo. If a specific page keeps timing out, raise the hard timeout and see whether it ever returns.
- **PDFs.** Markdown conversion is for HTML pages. If the permit facts live in a PDF, that's a separate fetch path.
- **The SERP zone has to be a SERP API zone.** If it isn't, search ends `error` with "wasn't JSON".
- **Live checks so far (2026-10-24):** bad key, bad zone, unresolvable host, client timeout and the government block were classified against real responses. A private venue page and SERP haven't been run live yet.
