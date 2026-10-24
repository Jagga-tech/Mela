# CLAUDE.md — Event Planning Agent: Research & Validation

Cal Hacks 13 project (Oct 23–25, 2026). Devpost submission due **Sun Oct 25, 9:00 a.m. PT**.

A host-first event-planning copilot. A host describes a milestone event by voice or text. The app returns a short, source-backed shortlist of venues and vendors with their requirements, costs, and visible unknowns. The host approves every external action.

This file covers **Matt's part**: Bright Data and Apify integration, source evidence, retrieval status, reliability, and end-to-end validation.

## How to work with me

- Explain the approach before any code. Show code in chat first; I write the implementation myself.
- Don't create or edit implementation files unless I explicitly say "write it." Ask before scaffolding, config, or fixtures too.
- Teach Socratically. Ask me a question when it will help me find the answer. Connect new ideas to things I know: Python, Flask, SQLAlchemy, PyTorch, and ML concepts like calibration and ablation.
- Give one direct recommendation with reasoning, not a list of options.
- Be honest about feasibility. If something won't fit before the deadline, say so and propose what to cut.
- I do smoke, regression, and E2E testing day to day, so frame validation work in those terms.
- Keep it friendly and informal.

## Ownership

**Mine:** the research module (path TBD, e.g. `lib/research/`). That covers discovery, fetching, extraction, verification, source status, the `ResearchResult` payload, the data-health view, and the smoke/regression checklist.

**Not mine, don't modify:** the frontend dashboard, event brief UI, Cartesia voice, finance (Hyphenate), Visa, Wajo, and SpacetimeDB. If my work needs a change in one of those, flag it instead.

**Main handoff:** the backend orchestrator serves my `ResearchResult` at `GET /events/:id/results`. Backend owner is **TBD** (the team plan names both Tanush and Chanpreet).

## Hard rules (sponsor rules and product guardrails)

1. **Live public data only.** Logged-out, public pages. Nothing behind a login or paywall.
2. **No mocked or hardcoded venue or vendor facts in the judged path.**
   - Hackpack sample records and fixtures are for tests only and must never be imported by runtime code.
   - Seed *URLs* are OK (confirm with Bright Data staff). Seed *facts* are not.
3. **Never hide a failure.** Slow, blocked, empty, and partial results are shown as what they are. Never swap in a substitute result.
4. **The LLM never invents values.** If the fetched page's text doesn't support a value, it's `unknown` with a reason.
5. **Code, not the model, handles verification, arithmetic, and status.**
6. **Secrets stay server-side.** Keys live in env vars and are read only in server code. `.env` is never committed.
7. **Bounded retries.** At most 2 attempts per source. No unbounded loops.

## Stack (assumed, confirm at kickoff)

- **Language:** TypeScript in the Next.js backend (route handlers and server modules), so there's one deployable.
- **Schema:** `zod` for the shared schema. Teammates import the types from it.
- **Env vars:** `BRIGHTDATA_API_TOKEN`, `BRIGHTDATA_UNLOCKER_ZONE`, `BRIGHTDATA_SERP_ZONE`, `APIFY_TOKEN`, plus the LLM key.
  - The team plan says `BRIGHTDATA_API_TOKEN`, but the Bright Data kit uses `BRIGHTDATA_API_KEY`. Pick one.

## Pipeline

discover → fetch → extract → verify → store

- **Discover with the Bright Data SERP API.** It has its own zone. It finds official city and venue pages. The Discover API has been removed, so don't use it.
- **Fetch with Bright Data Web Unlocker.**
  - Call `POST https://api.brightdata.com/request` with header `Authorization: Bearer <token>`.
  - Body: `{ zone, url, format: "raw", data_format: "markdown" }`.
  - The markdown output feeds extraction.
- **Extract with the LLM into a fixed schema.** Every value must come with a verbatim supporting quote from the page.
- **Verify in code.** See the verification rules below.
- **Store.** Save every status change immediately, so the frontend's 1–2 s poll sees in-flight states.
- **Apify runs in parallel and is never on the critical path.**
  - One Actor: `compass/crawler-google-places` via `apify-client`, with `maxCrawledPlacesPerSearch` around 10.
  - It finds public local vendors (caterers, florists). Normalize its results into `Vendor` records with their source URL.
  - Stretch: send the vendor websites back through Web Unlocker.

Use the Bright Data MCP server only to explore sources during development. The app itself calls the REST API from server code.

## Data contract (agree on this with backend and frontend before writing API code)

```ts
type SourceStatus =
  | "queued" | "searching" | "fetching" | "extracting"
  | "slow"                       // soft timeout hit, still in flight
  | "found" | "partial" | "empty" | "blocked" | "error";

interface ResearchSource {
  id: string;
  url: string;
  provider: "bd_serp" | "bd_unlocker" | "apify";
  sourceType: "official_city" | "venue" | "vendor";
  status: SourceStatus;
  fetchedAt?: string;            // ISO timestamp
  latencyMs?: number;
  attempt: number;               // 1 or 2
  error?: string;
}

interface ExtractedFact {
  entityId: string;              // venue or vendor
  field:
    | "capacity" | "rental_fee"
    | "application_lead_days" | "application_fee"
    | "step_free_access" | "amplified_sound" | "alcohol" | "insurance_required";
  state: "verified" | "unknown";
  value?: number | string | boolean;
  sourceId?: string;
  quote?: string;                    // verbatim from the fetched page
  confidence?: "exact" | "derived";  // set by code, never by the LLM
  unknownReason?: "not_on_page" | "quote_mismatch" | "source_failed";
  appliesTo: string[];               // venue ids this rule covers
}

interface ResearchResult {
  eventId: string;
  sources: ResearchSource[];
  facts: ExtractedFact[];
}
```

`unknown` is a real state with a reason, never a bare null.

## Status rules

- **Timeouts:** after about 8 s (soft timeout), a source becomes `slow` and keeps running. After about 25 s (hard timeout), it becomes `error` and gets retried once.
- **`blocked` vs `error`:** base this mapping on real Bright Data responses. Trigger a few real failures early and log what comes back before writing it.
- **`partial`:** the page was fetched, but some fields came back `unknown`.
- **`empty`:** the search returned nothing usable.

## Verification rules

1. Normalize both the page text and the quote: lowercase, collapse whitespace, and strip markdown symbols (`*`, `#`, `|`, `_`, link syntax).
2. If the quote isn't found in the page, the fact is `unknown` with reason `quote_mismatch`.
3. If the quote is found and the value appears literally in it, the fact is `verified` with `confidence: "exact"`.
4. If the quote is found but the value needed interpretation (e.g. "two months" → 60), the fact is `verified` with `confidence: "derived"`.
5. A city rule's `appliesTo` lists only the venues it covers (e.g. Rec & Park rules apply to park venues).

**Edge cases to test:** markdown tables, quotes that span line breaks, numbers written as words, and ranges like "100–150 guests".

## Demo scope

- **City:** San Francisco only.
- **Scenario:** an outdoor quinceañera with about 100 guests, step-free access, a firm budget, and food preferences.
- **Limits:**
  - 4–6 venues and at most 10 sources in total.
  - One page per source (two at most). No crawling.
- **Starting point:** a seed list of official URLs (e.g. the SF Rec & Park special-event page), plus SERP discovery for venues.

## Testing

| State | How to trigger (dev only) | Expected |
|---|---|---|
| found | real official page | facts with quote + `fetchedAt` |
| partial | page missing a field | that field `unknown` / `not_on_page` |
| slow | soft timeout set to 1 s | `slow` badge, still resolves |
| error / blocked | 404 URL, bad zone | error card, retry, max 2 attempts |
| empty | nonsense SERP query | "no result", venue excluded with reason |
| quote mismatch | LLM paraphrases | downgraded to `unknown` |

- **Fault injection:** flags exist only in dev and are off in the demo build.
- **Ablation test:** run the full E2E flow with a bad Bright Data key. Every fact must become `unknown` / `source_failed`, never the same shortlist. This proves nothing is hardcoded.
- **Smoke checklist before recording** (keep this current):
  - [ ] Keys load server-side; nothing in the client bundle
  - [ ] One live official page → facts with quote + `fetchedAt`
  - [ ] SERP discovery returns ≥ 1 venue page
  - [ ] Apify returns ≥ 1 vendor with a source URL
  - [ ] Each failure state renders correctly in the dashboard
  - [ ] Ablation test passes
  - [ ] No fixture or sample import reachable from runtime code

## Data-health view

One read-only page listing the `ResearchSource` rows: URL, status, latency, attempt, and error. It's a debugging tool during the build and the monitoring console during the demo. It never overwrites a public fact unless the change is labeled as a manual correction.

## Milestones

1. **Fri night:**
   - Get the keys working and curl Web Unlocker against the SF Rec & Park page.
   - Share the schema and build the status state machine.
   - Build extraction against hackpack sample records (tests only).
2. **Sat morning:** live extraction and verification on 2–3 venue pages.
3. **Sat afternoon:** SERP discovery and the Apify Actor; hand off `ResearchResult`.
4. **Sat evening:** full E2E runs, the failure matrix, and the ablation test.
5. **Late Sat / early Sun:** smoke checklist, feature freeze, and recording a real run.

Integration checkpoint with the team every 60–90 minutes.

## Open questions

- [ ] Who owns the backend: Tanush or Chanpreet?
- [ ] Is Apify priority 1 (my recommendation) or stretch?
- [ ] Confirm the SERP zone setup in the Cal Hacks hackpack's SETUP.md / AGENTS.md
- [ ] Confirm with Bright Data staff that seed URLs are OK
- [ ] Final env var name for the Bright Data key
- [ ] Is TypeScript confirmed as the backend language?