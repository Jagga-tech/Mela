Oct 24 2026: fake channel, console texts, simulated payments and the demo script were removed at the user's request; the flow runs only against iMessage, Cartesia and Stripe test mode. The demo files live outside the repo on the user's Mac.

# Mela agent demo flow: design

Oct 24 2026. Scope: the agent and backend half of the CalHacks demo. The frontend and the data collection are other teammates' work. Phone and iMessage are channels behind one adapter and get wired last.

Earlier plan docs (`docs/multi-agent-harness.md`, `docs/agent-flow.md`, `docs/phone-plan.md`, `docs/visa-plan.md`) still hold for anything this doc doesn't override. Where they disagree, this doc wins.

## Intent

A host describes an event once. Mela confirms the brief with them on a phone call, calls three vendors itself, reports each answer by text, asks for one approval by text, pays the vendors, and calls the host back with the confirmations. The host touches their phone twice. Judges see a Lead agent planning and delegating, while every gate and every dollar is enforced in code.

## The demo, step by step (locked)

| # | What happens | Who does it | Host sees |
|---|---|---|---|
| 1 | Host types or speaks the event on the web form and gives the number to reach them | Frontend → `POST /api/events` | Form |
| 2 | Intake agent drafts an `EventBrief` and lists missing high-impact fields | Intake agent | Follow-up questions on the form (frontend) |
| 3 | Mela calls the host, reads the brief back; host says yes or changes something; changes are applied on the call | Host call channel + Intake agent on the transcript | Phone call |
| 4 | Lead agent picks one venue, one caterer, one décor vendor from seeded data, runs fit rules | Lead agent, Vendor agent, `rules.ts` | Nothing yet |
| 5 | Mela calls each vendor in turn (teammates answer), asks availability and price | Outreach agent writes the script; vendor call channel runs it; Quote agent reads the transcript | One text per finished call, no action needed |
| 6 | After the third call: one summary text with three quotes, total vs budget, and an approval code | Code (`notify`) | "Reply YES 4821 to book all three, or NO 4821" |
| 7 | Host replies YES + code | Inbound text webhook | — |
| 8 | Code pays each vendor from the pre-loaded payment setup | `pay` job + Visa adapter (sandbox or simulated) | — |
| 9 | Mela calls the host with all confirmations; the same confirmations arrive as texts | Host call channel + `notify` | Call + 3 texts |

Vendors are told their booking is confirmed by one text each. No second vendor call. (My call; add the call-back later if the demo has time.)

## Goals

- The whole flow runs end to end from one script in fake-channel mode, with no phone, no iMessage, no Visa, and asserts the final state. This is the test and the dev loop.
- Swapping the fake channel for Cartesia calls and the Mac's Messages app changes no agent or rule code.
- The frontend team gets a fixed API and JSON shapes they can build against from day one.

## Non-goals (this phase)

Dashboard UI, Bright Data / Apify updater, CRS checks, the Hyphenate invoice-mismatch flow and Finance agent, Fetch.ai, SpacetimeDB. Each has a seam in this design and comes after the demo flow works.

## Anti-goals

- A "yes" on a phone call must never move money. Only an iMessage reply with the right code, or a signed-in dashboard click, approves spending.
- No agent output is ever treated as a number to trust. Prices, totals and budget checks are computed in code from values the Quote agent extracted with a cited transcript line.
- Never call something paid if no money moved. The simulated adapter labels every payment "simulated"; Visa sandbox labels it "sandbox".

## Decisions

### Approvals by iMessage with a code

- `Approval { id, eventId, kind: "plan" | "payment", code, summary, status: "pending" | "approved" | "declined" | "expired", expiresAt, answeredAt?, answeredFrom? }`.
- Code is 4 digits, unique among that event's open approvals, expires in 30 minutes.
- Inbound text handler: sender must match `event.hostPhone`; message must contain the code of an open approval; first word decides YES or NO. Anything else is a new request and starts a Lead run with the text as input. It never approves.
- NO marks the approval declined, sets the event to `needs_planner`, and texts "Got it, nothing is booked. A planner will follow up." CHANGE and re-planning after a declined approval are out of scope for this phase (my call: the demo host says YES; a re-plan loop needs stale-marking from `docs/agent-flow.md` §3 and is a separate piece of work). The summary text advertises only YES and NO.
- One approval covers the whole plan (all three vendors). Payment runs on the same approval because the demo pre-loads the payment limit. A separate payment approval is a one-line change if Visa requires it.
- The phone plan's rule becomes: calls never approve; iMessage with code approves; dashboard approves.

### Channels behind one adapter

```ts
// src/integrations/channel.ts
type Channel = {
  callHost(eventId, script: CallScript): Promise<{ callId }>;
  callVendor(eventId, vendorId, script: CallScript): Promise<{ callId }>;
  text(to: string, body: string): Promise<void>;
};
```

- Calls are always asynchronous. The adapter returns a `callId`; the transcript arrives later through `onCallEnded(callId, transcript)`, which the Cartesia webhook route calls in real mode and the fake adapter calls directly in-process.
- Fake adapter: `callHost` and `callVendor` return a scripted transcript from the seed file after a tick; `text` logs to the console and to the event's `messages[]`.
- Texts (Oct 24 change): sent from the Messages app on the demo Mac through `osascript`, and received by polling the Mac's Messages database (`~/Library/Messages/chat.db`) with the system `sqlite3` binary. No external text service for now. The backend runs on that Mac. Needs Full Disk Access for the terminal and Automation permission for Messages, granted once.
- Calls: Cartesia Line for both directions once its API is confirmed.
- Selection by two env vars: `MELA_TEXT=console|imessage` and `MELA_CALLS=fake|cartesia`. Dev and the end-to-end script use `console` + `fake`.
- Vendor phone numbers come from the seed data only, never from an agent's output or a transcript.

### Lead agent and its tools

The Lead is one `runAgent` with tools. Every tool is plain code. A fresh Lead run starts on each new input (brief confirmed, call ended, approval answered); state lives in the store, not in the Lead's context.

| Tool | Does | Refuses when |
|---|---|---|
| `find_vendors(category)` | Vendor agent over read-only store tools; returns options with facts | — |
| `check_fit(optionIds)` | `rules.ts`: capacity, date, budget, accessibility | — |
| `explain(fitResults)` | Explainer agent: one line per option | — |
| `call_vendor(vendorId, questions)` | Outreach agent writes the script, channel places the call, run ends | Vendor not in the fit set; a call already open for this vendor |
| `request_approval(kind, summary)` | Creates `Approval`, texts the host, run ends | An approval of that kind is already open |
| `notify_host(body)` | Texts the host | More than one text since the last state change |
| `call_host(script)` | Places the confirmation or brief-readback call, run ends | — |

Not given to the Lead: `pay`. Payment is a code job triggered by an approved plan approval. Per `docs/agent-flow.md` §3.

Lead limits: 15 tool calls per run, `effort: "medium"`. A run that hits the cap ends with a `HumanTask` for the planner and a log line.

### Specialist agents (no tools except where noted)

| Agent | Input | Output schema | Notes |
|---|---|---|---|
| Intake | Host text or call transcript, plus the current brief if any | `{ brief: EventBrief, missing: string[], changes: string[] }` | Same agent handles the first draft and the read-back call changes |
| Vendor | Brief + category | `{ options: { vendorId, facts: ExtractedFact[] }[] }` | Read-only store tools `search_vendors`, `get_vendor`. Venue is a category, not a separate agent |
| Explainer | Fit results with numbers | `{ reasons: Record<vendorId, string> }` | Never changes a fit status |
| Outreach | Vendor, brief, questions | `CallScript { opening, questions[], closing, mustNotAgreeTo[] }` | Opening always states: AI assistant, calling for a client, recorded |
| Quote | Vendor call transcript | `{ available: boolean \| null, priceUsd: number \| null, terms: string[], evidence: { field, line }[], openQuestions: string[] }` | Unknown stays null. Code builds the `Quote` record from this |

The Finance agent is out of scope for this phase.

### Harness changes (from `docs/agent-flow.md` §5, all applied in this phase)

- `runAgent` returns `{ ok: true, data } | { ok: false, reason: "bad_output" | "refused" | "error" }`, not `null`.
- Retry once only for agents without side-effecting tools. The Lead is never retried as a whole.
- `AgentSpec` gains `effort` and `maxToolRounds`.
- JSON parse failure logs as bad output. 400 and 401 errors are not retried.
- Error text is redacted before the audit log.
- Untrusted text (transcripts, host messages) is fenced in the input with a clear delimiter and an instruction that it is data.
- A one-line browser guard at the top (`if (typeof window !== "undefined") throw`) instead of the `server-only` package, so the same module runs under Next and under the standalone demo script.

### Event state and store

- `Event` gains `hostPhone: string`, taken from the create request and never from agent output. The host's number is the only sender the text handler accepts.
- `Event.status: "draft" | "confirming" | "confirmed" | "calling" | "awaiting_approval" | "approved" | "paying" | "paid" | "done" | "needs_planner"`. Moves forward only.
- Store is one module, `src/lib/store.ts`, over a JSON file in dev. Interface is just `getEvent`, `saveEvent`, `listVendors`, `getVendor`, `getApprovalByCode`, `claimIdempotencyKey`. SpacetimeDB replaces the file later.
- One Lead run per event at a time: an in-process lock map. Good enough for one demo machine.
- Every state-changing tool takes an idempotency key `eventId:action:args-hash`; a reused key is a no-op that returns the previous result.
- `AuditEvent` on every agent run, tool call, channel call and payment.

### Payment

- Pre-loaded before the demo: a `Mandate` per event with `capCents`, the three vendor IDs, and `expiresAt`. Seeded from a file, not created by the Lead.
- On plan approval, a `pay` job runs per vendor: checks mandate approved and unexpired, vendor in the mandate, amount under the remaining cap, idempotency key unused. Saves `Payment` as pending with its key, then calls the Visa adapter, then marks it `succeeded` or `failed`. A timeout leaves it `unknown` and never retries blindly.
- Visa adapter: real sandbox if credentials are present, otherwise simulated with a generated reference and `simulated: true`. Texts and the confirmation call say which.
- Amount paid per vendor is the deposit from the quote's terms if the Quote agent found one, otherwise the full price. Flagged in the summary text either way.

### Seed data

- `data/seed.json`: 3 to 6 vendors across venue, catering, décor, each with `id, name, category, phone, capacity, priceHintUsd, accessibility[], dietary[]`, plus the fake transcripts for each vendor and the host. Teammates' phone numbers go in `.env.local`, referenced by vendor ID, never committed.
- The data team's real shape replaces this file. `Vendor` in `types.ts` is defined from this seed now and adjusted once.

### API for the frontend

| Route | Body / returns |
|---|---|
| `POST /api/events` | `{ text, hostPhone }` → `{ eventId, brief, missing }`. `missing` is `{ field, question }[]`: `field` is an `EventBrief` key for the form to highlight, `question` is the text to show |
| `POST /api/events/:id/answer` | `{ text }` → updated `{ brief, missing }`; when `missing` is empty, triggers the host confirmation call |
| `GET /api/events/:id` | Full `Event`: status, brief, quotes, approvals, payments, messages, audit |
| `POST /api/webhooks/call-ended` | Cartesia → `{ callId, transcript }` |
| `POST /api/webhooks/text-inbound` | `{ from, body }`: used by the iMessage poller in-process and by dev tools; kept as a route so a hosted text service can plug in later |
| `POST /api/dev/run-demo` | Dev only: runs the whole flow in fake mode and returns the final `Event` |

The frontend polls `GET /api/events/:id`. Live push comes with SpacetimeDB later.

## Constraints

- Node, Next.js 15 route handlers, the Anthropic SDK's `toolRunner` with Zod output, as already in the repo. No new runtime dependencies for this phase. `tsx` is added as a dev dependency to run scripts.
- Model: `claude-opus-5-5` for all agents.
- `ANTHROPIC_API_KEY` server-side only.

## Test

One standalone script, `npm run demo:fake` (`tsx scripts/demo-fake.ts`, imports the orchestrator directly, no dev server needed), runs steps 1 to 9 with the fake channel and asserts: brief confirmed with the host's change applied, three quotes with cited evidence, one approval answered by the right code, three payments succeeded and labeled simulated, host notified, audit log non-empty, and that a wrong code or a wrong sender did not approve. `rules.ts` has its own small self-check. No test framework.

## Open for step 9 only

Cartesia Line agents may be deployed code on Cartesia's platform rather than an HTTP API that accepts a script, and the transcript may need fetching rather than arriving by webhook. Check at the Cartesia booth before step 9. `CallScript` stays the contract; the real adapter maps it to whatever Line needs. The host read-back call needs a two-way voice agent, not a script reader. Nothing in steps 1 to 8 depends on the answer.

## Left to the builder

- Prompt wording for each agent.
- Exact fit rules thresholds and the summary text template.
- How the fake adapter schedules its callbacks.
- File split beyond the modules named here.

## Build order

1. Harness changes and `store.ts` with seed data.
2. `rules.ts` with self-check.
3. Intake agent, run from a script.
4. Vendor, Explainer agents.
5. Fake channel, Outreach and Quote agents, `call_vendor` loop.
6. Lead agent with all tools; approvals; `notify`.
7. Payment job and simulated Visa adapter.
8. API routes and `demo:fake` end-to-end script.
9. Real channel adapters: iMessage on the Mac (send + poll), Cartesia stub.
