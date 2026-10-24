# Mela — Design handoff v2 (Maya · Oakland · $350)

Supersedes `docs/archive/design-handoff-v1-storehouse-100-120.md` (SF / Store House / 100→120 — do not reuse).

- Figma Design: https://www.figma.com/design/vCZexQrSHgrVtHctQ6g3S6
- Prototype (flow "▶ 1 · Demo", starts at P01): https://www.figma.com/proto/vCZexQrSHgrVtHctQ6g3S6?node-id=92-2
- Figma Slides (stage log): https://www.figma.com/slides/9UxnQHpYk1xlA6K3MFS4kI
- Fixtures: `docs/fixtures/finance-fixtures.json` (simulated; amounts in cents)

## The one story

Maya (host), Oakland, quinceañera, 80 guests, $14,000 cap all-in, warm / garden-like / family-centered, step-free + vegetarian must-haves, Sat May 15 ± 2 weekends — all entered by Maya.
Casa Verde (fixture) quote **Q-118 = $3,600 + $600 = $4,200**, approved by Maya → commitment C-031.
Invoice **INV-2291 = $4,550** with unquoted L3 "Setup & breakdown" **$350** → rule R-02 fails → payment draft PAY-0091 **held** → Rosa (AP manager, Mela Events) rejects L3 → policy **P-1 v2** proposed by the agent, approved by Rosa → replay: INV-2304 (+$60 delivery, 3.3%) auto-approved with notice; INV-2291 still held.

## Figma pages

| Page | Contents |
|---|---|
| 00 · READ ME | Scope, links, 3-minute path, implementation truth |
| 01 · FLOW | Role swimlane with five human gates; moment map (interaction → proof → recovery → frames) |
| 02 · DESIGN LANGUAGE | Thesis, references, semantic color + contrast, type, motion spec, do/don't, 12 component sets |
| 03 · WEB APP + PROTOTYPE | P01–P14 demo path + branches, S01–S07 states; 5 flows |
| 04 · STATES & HANDOFF | 1280 checks, breakpoints, engineering map, TS contracts, sponsor matrix |
| 99 · ARCHIVE 01–08 | Every earlier exploration, unchanged |

## Frames (node ids)

| Frame | Node | Purpose |
|---|---|---|
| P01 Opening | 92:2 | Mela wakes; Talk + Type equal |
| P02 Listening | 92:49 | Live transcript → tokens |
| P03 / P03b Shape | 93:79 / 93:319 | Brief + mood board; one question; answer updates canvas |
| P04 Researching | 94:433 | Bright Data / Apify job rows incl. partial + blocked |
| P05 / P05-alt Discover | 94:705 / 94:974 | Must-have toggle changes results |
| P06 / P06b Decide | 95:1076 / 95:1344 | Compare; chosen ≠ booked |
| P07 Evidence drawer | 95:1625 | Source facts with retrieval time |
| P08 Consent | 96:1543 | Shared fields highlighted, budget private, Draft ≠ Sent |
| P09 Quote | 96:1767 | Maya approves $4,200 → commitment |
| P10 Handoff | 96:1920 | Role switch to Mela Events |
| P11 Exception | 97:1835 | $350 isolated, PAY-0091 held, R-02 |
| P12 Decision | 97:2033 | Manager decides with reason; agent cannot |
| P13 / P13b Audit + policy | 98:2049 / 98:2221 | Append-only log, policy diff, replay |
| P14 Return | 98:2438 | Status, unknowns, freshness, next action |
| S01–S07 | 99:2483, 99:2550, 99:2647, 99:2995, 99:3095, 99:3277, 99:3298 | Mic declined, no match/timeout, stale source, clean match, waiting on vendor, empty/first visit, kept as draft |

Keyboard path in the prototype: Enter = primary action, Esc = back/stop, Space = talk.

## Components → React (proposed names)

| Figma set | React | Key props |
|---|---|---|
| Mela Orb (88:137) | `<MelaOrb state>` | idle · inviting · listening · thinking · speaking · succeeded · uncertain · caution · handoff · error |
| Voice Dock (88:305) | `<VoiceDock state>` | idle · listening · thinking · speaking · micOff · error |
| Evidence Badge (87:91) | `<EvidenceBadge kind>` | verified · estimated · unknown · representative · publicPost · simulated · stale · yourWords · draft · ready · sent · held · approved · rejected · exception |
| Brief Chip (87:197) | `<BriefChip field value priority justHeard>` | must · preferred · flexible · unset |
| Button (87:125) | `<Button variant state>` | primary · secondary · ghost · danger · onDark |
| Source Fact (89:134) | `<SourceFact provider>` | brightData · apify · fixture · host |
| Research Job (89:189) | `<ResearchJob status>` | queued · running · done · partial · blocked · timeout |
| Candidate Card (91:484) | `<CandidateCard state>` | default · selected · excluded |
| Finance Row (89:232) | `<FinanceRow state>` | header · match · notInQuote · missingOnInvoice |
| Audit Item (89:269) | `<AuditItem actor>` | agent · human · system |
| App Bar (91:343) | `<AppBar role step>` | host(shape/discover/decide/protect) · manager(exceptions/audit) |
| Toast (89:304) | `<Toast kind>` | info · success · undo · error |

Tokens: collection **Mela Semantic** (36 aliases, web syntax `var(--mela-<group>-<name>)`, e.g. `var(--mela-status-held-fg)`) over primitives in **Mela Tokens**. Text styles Display/Heading/Body/Label/Data (Instrument Serif / Instrument Sans / Geist Mono). Contrast verified ≥ 4.5:1 for all text pairs after darkening `text/tertiary` to #6C6371 and `status/unknown` to #6B636F.

## Engineering map

Repo had no commits on Oct 24 2026; routes are proposals.

| Screen · route | Data | Service (real vs simulated) | Failure behavior |
|---|---|---|---|
| P01–P02 `/` | Utterance → EventBrief draft | Cartesia STT/TTS; LLM extraction to JSON schema | Mic denied → text path (S01). STT error keeps partial transcript + Retry |
| P03 `/event/:id` | EventBrief, Preference[] | local + persist | Save failure shows "Not saved" + retry |
| P04–P05 `/event/:id/discover` | ResearchJob, SourceFact[], Recommendation | Bright Data (official pages, server-side, bounded), Apify Actor dataset; deterministic must-have filter | Blocked → "open it yourself"; timeout → cached + date; zero results → S02 |
| P06–P07 `/event/:id/decide` | Recommendation, SourceFact | read-only | retrievedAt > 7 days → Stale + Re-check |
| P08 sheet | OutreachDraft, Contact | Email provider only if configured | "Sent" only with provider message id; else stays Draft |
| P09 `/event/:id/decisions` | Quote, Commitment | local finance state machine (simulated vendor reply) | Approval writes Commitment + AuditEvent |
| P10–P13 `/ops/exceptions/:id` | Invoice, Exception, Approval, PolicyVersion, AuditEvent | deterministic R-02 / P-1 in code; LLM writes explanations only; **no Hyphenate API** | Agent role cannot approve/release (server-enforced); decision requires reason |
| P14 `/event/:id` | EventSummary | derived | Missing data renders "Unknown", never blank |

## Shared contracts

```ts
type Provenance = 'verified' | 'estimate' | 'unknown' | 'representative' | 'public_post' | 'simulated' | 'host_said';
type Priority = 'must' | 'preferred' | 'flexible' | 'unset';
interface Preference { field: 'city'|'guests'|'budget_cap'|'budget_scope'|'access'|'food'|'date'|'feeling'; value: string; priority: Priority; saidAt?: string; quote?: string }
interface EventBrief { id: string; hostId: string; occasion: string; city: string; guests: number; budgetCapCents: number; budgetScope: 'all_in'|'food_venue'|'unset'; dateTarget: string; dateFlexWeeks: number; prefs: Preference[] }
interface SourceFact { id: string; claim: string; provider: 'bright_data'|'apify'|'fixture'|'host'; url?: string; retrievedAt: string; snippet?: string; provenance: Provenance }
interface Contact { email?: string; phone?: string; sourceFactId: string }
interface Vendor { id: string; name: string; kind: 'caterer'|'venue'; area: string; contact?: Contact }
interface Recommendation { vendorId: string; fit: SourceFact[]; unknowns: string[]; excludedBy?: Preference; priceClaim?: SourceFact; status: 'candidate'|'chosen'|'excluded' }
interface QuoteLine { id: string; label: string; qty: number; unitCents: number; totalCents: number }
interface Quote { id: string; vendorId: string; lines: QuoteLine[]; totalCents: number; approvedBy?: string; approvedAt?: string; simulated: true }
interface Commitment { id: string; eventId: string; quoteId: string; limitCents: number; approvedBy: string; approvedAt: string }
interface InvoiceLine { id: string; label: string; totalCents: number; quoteLineId?: string }
interface Invoice { id: string; quoteId: string; commitmentId?: string; lines: InvoiceLine[]; totalCents: number; receivedAt: string; simulated: true }
interface Exception { id: string; invoiceId: string; rule: 'R-02'; failingLineIds: string[]; deltaCents: number; status: 'held'|'resolved'|'waiting_vendor'; paymentDraftId: string }
interface Approval { id: string; exceptionId?: string; policyId?: string; decision: 'approve'|'reject'|'ask_vendor'; reason: string; actorId: string; actorRole: 'ap_manager'; at: string }
interface PolicyVersion { id: 'P-1'; version: number; rule: string; maxAutoCents: number; maxAutoPct: number; proposedBy?: string; approvedBy?: string; approvedAt?: string }
interface AuditEvent { id: string; at: string; actor: { kind: 'agent'|'human'|'system'; id: string; role?: string }; action: string; refs: string[] }
```

Invariants (enforce on the server, test first): role `ap_agent` can never create an `Approval`; requester ≠ approver; a draft becomes `sent` only with a provider message id; every state change appends an `AuditEvent`.

### Rule R-02 and policy P-1 (reference implementation logic)

An invoice line passes if it maps to a quote line with the same total. Failing lines are summed; under P-1 v1 any failing amount holds payment. Under v2 the failing amount is auto-approved with notice only if it is ≤ $75 **and** ≤ 5% of the quote total; otherwise held. Expected results are recorded in the fixtures (`expected.v1` / `expected.v2`): INV-2291 held/held, INV-2290 matched/matched, INV-2304 held/auto-approved.

## Motion (summary — full table on 02 · DESIGN LANGUAGE)

Word→token 320ms cubic-bezier(.2,.8,.2,1); opening→studio 600ms ease-out; drawers/sheets 240ms ease-out with focus trap; handoff dissolve 600ms; $350 isolation 400ms row emphasis, no shake. `prefers-reduced-motion`: transforms become ≤150ms opacity fades; the orb is static.

## Not done / manual

- Embed the prototype in Slides (Live interactions → Prototype → flow "▶ 1"); the Plugin API cannot create embeds.
- Set both Figma files to "Anyone with the link"; Figma Edu verification for each teammate.
- App code, sponsor integrations, demo video.
- Figma Make was not used; the earlier Make link could not be opened through the MCP tools.
