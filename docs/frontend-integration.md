# Mela web app: integration handoff

Branch: `feat/mela-web-frontend`, based on `origin/agent-demo-flow`. The other remote branch, `data-sys`, shares no history with it (see §8).
Status as of Oct 24 2026, 1:50 PM PDT: the whole flow runs in demo mode, with 84 tests passing and `next build` passing. No live sponsor API has been exercised yet, because no keys were available on the build machine.

## 1. Run it

```bash
npm ci
npm run dev          # http://localhost:3000. Demo mode by default, needs no keys
npm test             # node:test, the 50 existing tests plus 34 web tests
npx next build
```

Click **"Try the demo example"** on the welcome screen to load the canonical scenario.

## 2. Modes and env vars

Each capability can go live on its own. Anything not listed below stays on the **labeled demo adapter**. A live endpoint that is missing shows a "not connected" error. It never quietly falls back to fixtures.

| Var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_MELA_LIVE` | client (not secret) | Comma list: `intake,research,calls,finance` (or `all`). Default is empty, which means all demo |
| `ANTHROPIC_API_KEY` | server | `POST /api/intake` runs `src/agents/intake.ts` |
| `CARTESIA_API_KEY` | server | `/api/voice/*` (ink-whisper STT, sonic TTS). Without it, the app uses the browser's speech recognition with a label, and text always works |
| `CARTESIA_VOICE_ID`, `CARTESIA_TTS_MODEL` | server | Optional. Defaults: Cartesia's docs example voice and `sonic-3.6` |

Keys are only read in route handlers. The test `tests/mela-adapters.test.ts` fails if client code reads a non-`NEXT_PUBLIC_` env var. A production build with sentinel keys found no key values or key names in `.next/static`.

## 3. Architecture

```
src/mela/screens/*      presentation (one file per Figma frame group)
src/mela/ui/*           Figma components: MelaOrb, Button, Badge, Composer, Dialog
src/mela/state/*        flow reducer (pure) + MelaProvider (the only caller of the service)
src/mela/service.ts     MelaService interface
src/mela/adapters/      demo.ts (fixtures) · api.ts (fetch + zod validation) · index.ts (per-capability switch)
src/mela/domain/*       deterministic rules: intake, match, calls (approval gate), finance (R-02)
src/mela/contracts.ts   zod schemas: the contract below
src/mela/fixtures/      scenario data, all fictional and labeled
```

Recommendations are always computed by `domain/match.ts` from `SourceFact[]`, for live and demo data alike. The backend only needs to return facts with sources. It must not return fit scores.

## 4. Endpoints the frontend expects

All bodies and responses are validated against `src/mela/contracts.ts`. Status codes map to UI states as follows: 404, 501 or 503 means "not connected"; 403, 409 or 422 means "refused" (the server's `error` text is shown); other non-2xx codes mean "server error" with a retry. Return `{ "error": "human sentence" }` on failure.

| Feature | Frontend consumer | Endpoint | Owner | Status | Test |
|---|---|---|---|---|---|
| Intake (text/voice transcript) | `MelaProvider.say` | `POST /api/intake` `{text, brief\|null, answering?}` → `IntakeResult` | Tanush (route) over Chanpreet's intake agent | **Built on this branch.** Not verified live (no key) | `ANTHROPIC_API_KEY=… NEXT_PUBLIC_MELA_LIVE=intake npm run dev`, then type a description |
| Voice | `Composer` / `useVoice` | `GET /api/voice/status`, `POST /api/voice/transcribe` (multipart `file`), `POST /api/voice/speak` `{text}` → mp3 | Tanush | **Built.** Returns 503 without a key (verified). Real Cartesia not yet verified | Set `CARTESIA_API_KEY`, click *Talk to Mela*, toggle *Mela speaks* |
| Research start | `startResearch` | `POST /api/research` `{brief}` → `ResearchSnapshot` | Matthew (+ orchestrator) | **Pending.** Demo replays a recorded run | `NEXT_PUBLIC_MELA_LIVE=research`, confirm the brief |
| Research poll / cancel | `DiscoverScreen` (polls every 450 ms while `job.status==="running"`) | `GET /api/research/:jobId` → `ResearchSnapshot` · `DELETE /api/research/:jobId` | Matthew | **Pending** | same |
| Call plan | `prepareCall` | `POST /api/calls/plans` `{brief, vendorId}` → `CallPlan` | Chanpreet | **Pending.** Demo builds the plan locally | `NEXT_PUBLIC_MELA_LIVE=calls` |
| Call approval | `approveAndCall` | `POST /api/calls/approvals` `{planId, planVersion, scriptHash, approvedBy}` → `CallApproval` | Chanpreet | **Pending** | |
| Place call (one attempt) | `approveAndCall` | `POST /api/calls` `{planId, approvalId}` → `{attempt, approval}`. **Must run `checkCallGate`** | Chanpreet | **Pending.** `src/integrations/cartesia.ts` is still a stub | |
| Call status | `ContactScreen` (polls every 500 ms) | `GET /api/calls/:attemptId` → `{attempt, outcome\|null}` | Chanpreet | **Pending** | |
| Finance case | `openFinance` | `POST /api/finance/cases` `{briefId, venueId}` → `FinanceCase` | Chanpreet | **Pending.** The demo runs `domain/finance.ts` in the browser | `NEXT_PUBLIC_MELA_LIVE=finance` |
| Manager decision | `decide` | `POST /api/finance/cases/:id/decisions` `{decision, reason, actor}` → `FinanceCase` | Chanpreet | **Pending** | |

The frontend does **not** call `POST /api/events`, `/answer` or `/dev/run-demo`. They start the autonomous flow (a host confirm call, then vendor calls, a text-code approval, and Stripe test deposits). That conflicts with the plan's rule of "host approves each action, no payment" (§7).

### Example payloads

`POST /api/research` → `ResearchSnapshot` (abbreviated):

```json
{
  "job": { "id": "job_1", "briefId": "brief_1", "briefVersion": 4, "status": "running", "startedAt": "2026-10-24T20:42:14Z",
    "origin": { "mode": "live", "provider": "bright_data", "label": "Bright Data · live read" },
    "sources": [ { "id": "s1", "url": "https://venue.example/rentals", "label": "venue.example/rentals", "provider": "bd_unlocker",
      "sourceType": "venue_site", "status": "slow", "attempt": 1, "vendorId": "v1" } ] },
  "vendors": [ { "id": "v1", "name": "…", "category": "venue", "area": "Oakland", "fictional": false,
    "contact": { "phone": "+1…", "sourceLabel": "Official contact page", "sourceUrl": "https://…", "sourceFactId": "f9" } } ],
  "facts": [
    { "id": "f1", "vendorId": "v1", "field": "capacity", "state": "verified", "value": 120, "quote": "Seated capacity: 120 guests",
      "url": "https://venue.example/rentals", "retrievedAt": "2026-10-24T20:42:16Z", "sourceId": "s1" },
    { "id": "f2", "vendorId": "v1", "field": "climate_control", "state": "unknown", "unknownReason": "not_on_page" },
    { "id": "f3", "vendorId": "v1", "field": "rental_fee", "state": "verified", "value": 110000, "qualifier": "exact", "quote": "Saturday rental: $1,100" }
  ],
  "reviews": [ { "id": "r1", "vendorId": "v1", "kind": "review", "provider": "apify", "url": "https://…", "retrievedAt": "…",
    "excerpt": "…", "attribution": "Google Maps review via Apify · handle not stored", "sampleContext": "1 of 37 reviews, sampled Oct 24" } ]
}
```

Rules the UI depends on:
- `SourceStatus` values are exactly the ones in Matthew's `lib/research/contract.ts`.
- Money is in integer cents.
- Use `qualifier: "starting_at" | "approximate"` for "from about $35". The UI then labels the price an **Estimate**.
- Unknown is `state:"unknown"` with a reason. Never send a guessed value.

`POST /api/calls` must refuse (409 with `error`) unless `checkCallGate(approval, plan)` from `src/mela/domain/calls.ts` returns `ok`. That check covers plan id and version, script hash, number, vendor, disclosed keys, expiry (15 min) and one attempt. `CallAttempt.mode` must be `"role_play"` for the teammate call. An outcome's `availability` can never be `booked` or `written_confirmation`.

Finance routes should call `buildFinanceCase` / `recordManagerDecision` from `src/mela/domain/finance.ts` on the server. The agent role is refused, a reason is required, and there is no "paid" state.

## 5. Contract mapping to the agent backend

`src/mela/adapters/agentBrief.ts` maps the web `EventBrief` to and from `src/lib/types.ts` `EventBrief`. Gaps in the agent type are:
- no guest **range**
- no **budget scope** (venue-only vs all-in)
- no requirement keys (only free-text `preferences[]`)

The route fills these from the host's literal words. If the agent schema gains `guestMin`/`guestMax` and `budgetScope`, the mapping gets simpler.

## 6. What is real vs demo (be exact in the pitch)

| Piece | Real | Demo / simulated |
|---|---|---|
| Intake | `/api/intake` uses the Claude intake agent when keyed | Rule-based reader, labeled "built-in rules (demo, no AI model)" |
| Voice | Cartesia STT/TTS through server routes when keyed | Browser speech recognition, labeled. Text always works |
| Research | none yet | Replay of a recorded run with **fictional** vendors (`.example` domains, 555 numbers) |
| Requirement matching, labels, budget | deterministic code, real | runs on whatever facts it gets |
| Call gate | deterministic code, real | the call itself is simulated; no phone dialed |
| Finance R-02, hold, decision, audit | deterministic code, real | quote and invoice are simulated; no Hyphenate API; no money moves |

## 7. Scenario discrepancies and the one decision needed

| | Figma v2 (`docs/design-handoff.md`) | Build plan (`Mela_CalHacks_Optimized_Build_Plan.docx`) | `agent-demo-flow` backend | `data-sys` research | This branch |
|---|---|---|---|---|---|
| Scenario | Maya, Oakland quinceañera, 80 guests | Oakland baby shower, 75–100, Jan 17 2027 | SF quinceañera, 100→110, Dec 6 2026 | SF outdoor quinceañera, ~100 | **Plan doc**, kept in `fixtures/oakland-baby-shower.ts` |
| Budget | $14,000 all-in | $2,000 **venue only**, catering separate | $12,000 + $12,000 payment mandate | "firm budget" | Scope is always asked; demo answer is venue-only |
| Finance numbers | Q-118 $4,200 vs INV-2291 $4,550 (+$350), policy P-1 v2 | illustrative $1,250 vs $1,400 (+$150) | none (Stripe test deposits instead) | none | Engine passes **both** fixture sets; demo uses $1,250 / $1,400 / $150 |
| Approval model | email draft consent, quote approval | research approval + **one** approved role-play call; no payment | host texts `YES 1234` → Mela books **and pays** all vendors | n/a | research approval + one call approval bound to the plan hash; no payment |
| Categories | caterers + venues | venue + catering | venue, catering, décor | city permits + venues | venue + catering |

Figma frames affected if the plan doc is confirmed: P01 copy, P03 brief chips, P05/P06 vendor names, P08 (email → call plan), P09 quote, P11–P13 amounts ($350 → $150), P13b policy (not built here).

**Decision needed (one):** confirm that the judged demo is the build-plan flow, meaning the Oakland baby shower, the host approving each outside action, one role-play call, and a simulated finance hold with no payments. That flow should replace the `agent-demo-flow` autonomous call-and-pay loop in the demo. Once that's decided, Figma P08–P13 numbers need a pass. If the team chooses Maya instead, add a second scenario file. The UI reads scenario data only from `src/mela/fixtures/`.

## 8. Git and branches

- `main` has no commits locally. `origin/HEAD` points to `data-sys`. `data-sys` and `agent-demo-flow` have **no common ancestor**.
- This branch sits on top of `agent-demo-flow`, the only branch with the Next.js app. Merge order: open a PR `feat/mela-web-frontend → agent-demo-flow`, then make `agent-demo-flow` the default branch, or fast-forward `main` to it.
- `data-sys`: copy `lib/research/` into `src/lib/research/` in a PR on top of the result, as Matthew's README describes. Don't `--allow-unrelated-histories` merge it, because `package.json`, `README.md`, `.gitignore` and `tsconfig.json` would all conflict.

## 9. Who can work where without conflicts

- **Matthew:** `src/lib/research/**` and `src/app/api/research/**`. Return `ResearchSnapshot`. Use the `Vendor`, `SourceFact` and `ReviewEvidence` shapes from `contracts.ts`, or adjust `contracts.ts` in a small PR and ping Tanush.
- **Chanpreet:** `src/app/api/calls/**`, `src/app/api/finance/**`, `src/integrations/cartesia.ts`. Import `checkCallGate` and the finance functions from `src/mela/domain/*`.
- **Tanush:** `src/mela/screens|ui|state/**`.
- **Design:** `src/app/globals.css` tokens and Figma.
- Shared, so coordinate first: `src/mela/contracts.ts`, `src/mela/domain/*`.

## 10. Figma → code

| Figma | Code | Figma decision used in code |
|---|---|---|
| Mela Orb 88:137 (10 states) | `ui/MelaOrb.tsx` | Same 10 states, badges and ring colors. Static under reduced motion |
| Voice Dock 88:305 | `ui/Composer.tsx` | Talk and Type have equal weight. Captions stay on screen |
| Evidence Badge 87:91 | `ui/primitives.tsx` `Badge` | Kinds: verified, estimated, unknown, simulated, held… |
| Button 87:125 | `Button` | primary, secondary, ghost, danger, onNight |
| Brief Chip 87:197 | `ShapeScreen` `FieldCard`, requirement rows | must / preferred / flexible / **unset** (dashed) |
| Research Job 89:189 | `DiscoverScreen` `SourceList` | running, partial, blocked rows (P04) |
| Candidate Card 91:484 | `DiscoverScreen` `VendorCard` | "Fails a must-have" never shown as a match |
| Finance Row 89:232 | `OpsScreens` table | the failing line gets a 400 ms emphasis and no shake |
| Audit Item 89:269 | `OpsScreens` `Audit` | agent / human / system icons |
| App Bar 91:343 | `MelaApp` `HostBar` / `OpsBar` | host steps vs the manager seat |
| Tokens "Mela Semantic" | `globals.css` `--mela-*` | values copied from the Figma variables |
| Motion spec | `globals.css` | 320 ms rise, 240 ms sheets, 600 ms handoff |

Screenshots of the implemented flow are in `docs/screenshots/` (01–17).
Not built: Mela's World (optional, cut), policy P-1 v2 proposal (P13b), email drafting, sign-in.

## 11. Fastest 3-minute demo

1. Welcome → *Try the demo example* (or speak it) → answer **Venue only** → mark capacity and the venue cap as must-haves → **Yes, start researching**.
2. Watch sources settle: one partial, one blocked, one empty. Open Lakeview Loft's evidence. Point at Fruitvale ("climate unknown, fees unknown") and the excluded venues.
3. Choose Lakeview Loft + Cocina Abuela → *Compare & decide* → *Prepare a call plan* → show shared vs private → **Approve & call once**.
4. The simulated call answers verbally. Point out "Not booked · No written quote".
5. *Hand off to Mela Events* → exception: +$150 setup fee held → **Review & decide** → Reject with a reason → audit trail.
6. *Return to the host* → summary: what Mela did and didn't do.

Before recording, set `CARTESIA_API_KEY` and `ANTHROPIC_API_KEY` with `NEXT_PUBLIC_MELA_LIVE=intake` so voice and intake are real. Everything else stays labeled demo until the matching endpoints exist.
