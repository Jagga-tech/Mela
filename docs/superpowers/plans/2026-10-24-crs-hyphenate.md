# CRS Vendor Check and Hyphenate Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before any money leaves, code checks who Mela is paying through the CRS sandbox (Fraud Finder on the vendor's contact details plus a reverse phone lookup), and a labeled Hyphenate-style prototype holds purchase orders, matches invoices, blocks payment on a mismatch, and asks the host to approve the balance when the invoice is clean.

**Architecture:** Both additions are code gates in front of `payVendor`, never Lead tools. CRS results are stored per vendor with a 7-day freshness window and mapped to `clear | review | block` by fixed rules. The Hyphenate prototype lives in `src/integrations/hyphenate.ts` and writes POs, invoices and finance exceptions onto the event; swapping in Hyphenate's real API later means replacing that one module.

**Tech Stack:** as the main plan (Next 15, TS, Zod 4, `node:test`, `tsx`). Global `fetch` with `AbortSignal.timeout`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-agent-demo-flow-design.md` plus `docs/crs-plan.md` (C1, C2 framing) and `docs/hyphenate-plan.md` (UC1, UC2, UC4). Decisions below override those where the sandbox differs.

## Global Constraints

- Branch `agent-demo-flow-final-fixes` in the worktree `/Users/chanpreetsingh/Mela-final-fixes` only. Commit by explicit path; messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- CRS sandbox facts (from the MCP package's OpenAPI spec): base `https://api-sandbox.stitchcredit.com/api`; `POST /users/login {username,password}` → `{ token, expires }`; `Authorization: Bearer <token>`; `POST /fraud-finder/{config}` (standard config `fraud-finder`) with `{ email?, firstName, lastName, phoneNumber, address? }` → `{ risk: { score, tumbling_risk, postal: { first_name_match, last_name_match, deliverability }, phone: { line_type, status, prepaid } }, ... }`; `POST /accurate-append/reverse {phoneNumber, firstName?, lastName?}` → `{ success, data: { records: [{ firstName, lastName, address, city, state }] } }`. There is no business-credit or OFAC product in the sandbox; the plan uses only the two above.
- Risk rules are code, not model: `block` when `risk.score >= 90` or `tumbling_risk` is truthy; `review` when the check could not run, `score >= 50`, phone `status` present and not `active`, postal `last_name_match === "no"`, or the reverse lookup finds no record whose last name matches the vendor contact; else `clear`. Thresholds are constants with a `// ponytail:` comment (AtData score assumed 0–100, higher = riskier; confirm at the booth).
- No CRS result newer than 7 days with level `clear` → `payVendor` refuses `vendor_risk`. No credentials → the check records `review` with reason "CRS not configured". Raw CRS reports never reach the host or the audit log; only level and reasons.
- Open `FinanceException` for a vendor → `payVendor` refuses `finance_hold`. Only a planner clears exceptions (out of scope here beyond the record).
- Idempotency keys: deposit `eventId:pay:vendorId`, balance `eventId:pay:vendorId:balance`.
- The Lead gets no CRS or finance tools. `find_vendors` hides vendors whose stored risk is `block`.
- Tests use `node:test` with fake `fetch` functions; no network, no model in tests (the Finance agent is injected).

## Review Focus

- CRS returns 401 after the cached token expires → the client re-logs in once and retries; a second 401 throws. Pinned in Task 1.
- Fraud Finder succeeds but the reverse lookup times out → level `review` with reason "phone lookup unavailable", not `clear`. Pinned in Task 1.
- Invoice total equals the PO but payment instructions carry a different phone → `payment_change` exception, approver planner, payment refused. Pinned in Task 2.
- Second invoice from the same vendor with the same total within 7 days → `duplicate` exception. Pinned in Task 2.
- Clean invoice when the deposit already covered the full price → no payment approval is requested and the host is told nothing more is due. Pinned in Task 2.

---

### Task 1: CRS vendor risk check before payment

**Files:**
- Create: `src/integrations/crs.ts`, `tests/crs.test.ts`
- Modify: `src/lib/types.ts`, `src/lib/rules.ts`, `src/lib/store.ts`, `src/lib/payments.ts`, `src/lib/events.ts`, `src/agents/lead.ts`, `data/seed.json`, `.env.example`, `tests/rules.test.ts`, `tests/payments.test.ts`, `tests/store.test.ts`

**Interfaces:**
- Produces:

```ts
// types.ts
export type Vendor = { ...existing; contactFirstName: string; contactLastName: string; email: string | null;
  address: { addressLine1: string; city: string; state: string; postalCode: string } | null };
export type RiskLevel = "clear" | "review" | "block";
export type VendorRisk = { vendorId: string; level: RiskLevel; reasons: string[]; checkedAt: string; source: "crs" };
export type ShortlistItem = { ...existing; risk?: RiskLevel };
// crs.ts
export type FraudFinderResult = { risk: { score: number; tumbling_risk?: number; postal?: { first_name_match?: string; last_name_match?: string; deliverability?: string }; phone?: { line_type?: string; status?: string; prepaid?: boolean } } };
export type ReverseResult = { success: boolean; data?: { records: { firstName: string; lastName: string; address?: string; city?: string; state?: string }[] } };
export type CrsClient = {
  fraudFinder(v: Vendor): Promise<FraudFinderResult>;   // body: email ?? undefined, firstName/lastName from contact, phoneNumber: vendor.phone digits, address when present
  reversePhone(v: Vendor): Promise<ReverseResult>;       // body: { phoneNumber, firstName, lastName }
};
export function crsClient(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): CrsClient | null;
// null when CRS_USERNAME or CRS_PASSWORD is unset. Base = env.CRS_BASE_URL ?? "https://api-sandbox.stitchcredit.com/api"; config = env.CRS_CONFIG ?? "fraud-finder".
// Token cached in the client until (expires − 60 s); on 401 log in again and retry once; any other non-2xx throws Error(`crs ${status} ${messages?.[0] ?? ""}`). 15 s AbortSignal.timeout on every call.
// rules.ts
export const RISK_BLOCK_SCORE = 90; export const RISK_REVIEW_SCORE = 50;
export function vendorRisk(ff: FraudFinderResult | null, rev: ReverseResult | null, vendor: Vendor): { level: RiskLevel; reasons: string[] };
export const RISK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export function riskIsFresh(r: VendorRisk | null, now: Date): boolean;   // r && now − checkedAt < RISK_TTL_MS
// store.ts
Store.getVendorRisk(vendorId: string): Promise<VendorRisk | null>;
Store.saveVendorRisk(r: VendorRisk): Promise<void>;   // file JSON gains risks: Record<vendorId, VendorRisk>
// payments.ts
export type PayRefusal = existing | "vendor_risk";
payVendor(event, store, pay, vendorId, amountCents, now, risk: VendorRisk | null): refuses "vendor_risk" right after "vendor_not_in_mandate" unless riskIsFresh(risk, now) && risk.level === "clear"
// events.ts
export async function ensureVendorRisk(vendor: Vendor, now: Date): Promise<VendorRisk>;
// fresh stored result → return it; else client = crsClient(); null → save { level: "review", reasons: ["CRS not configured"] };
// else run fraudFinder and reversePhone (each in its own try; a throw → null), vendorRisk(...), save, audit actor "crs" action "crs_check" detail `${vendorId} ${level}: ${reasons.join("; ")}`
// runPayments: before each payVendor call `const risk = await ensureVendorRisk(vendor, now)`; pass it; on refusal vendor_risk → HumanTask to planner "Vendor check for <name>: <reasons>" and REFUSAL_WORDS.vendor_risk = "vendor check not clear"
// lead.ts find_vendors: skip vendors whose stored risk level is "block" (log "vendor_hidden <id>"); set item.risk from the stored risk when present
```

- `data/seed.json` vendors gain `contactFirstName`, `contactLastName`, `email: null`, `address: null` with placeholder names (Ana Verde, Luis Mesa, Flor Diaz). The user will replace them with sandbox persona data.
- `.env.example` gains `CRS_USERNAME=`, `CRS_PASSWORD=`, `CRS_BASE_URL=`, `CRS_CONFIG=`.

- [ ] **Step 1: Write failing tests.**
  `tests/crs.test.ts` (fake fetch that records calls and returns scripted responses):
  - `crsClient({})` → null.
  - first `fraudFinder` call logs in (`/users/login` with username/password) then POSTs `/fraud-finder/fraud-finder` with `Authorization: Bearer tok1` and a body containing `phoneNumber` digits and `firstName`/`lastName`; a second call does not log in again (token cached).
  - a 401 on the product call → re-login then retry succeeds (login called twice, product called twice); a second 401 → throws `/crs 401/`.
  - 500 with `{ messages: ["boom"] }` → throws `/crs 500 boom/`.
  `tests/rules.test.ts` additions: score 10 + active phone + last_name_match "yes" + reverse record with matching last name → `clear`; score 95 → `block`; score 60 → `review`; `ff` null → `review` with reason containing "unavailable"; reverse `records: []` → `review` with "phone not found"; `riskIsFresh` false for 8-day-old, true for 1-day-old, false for null.
  `tests/payments.test.ts` additions: happy path now passes a fresh `clear` risk; `review` risk → `vendor_risk`; stale clear (8 days) → `vendor_risk`; `null` → `vendor_risk`.
  `tests/store.test.ts` addition: `saveVendorRisk` then `getVendorRisk` round-trips; `getVendorRisk("none")` → null.
- [ ] **Step 2: `npm test`** → new tests fail.
- [ ] **Step 3: Implement** the files above. Keep `crs.ts` under ~70 lines.
- [ ] **Step 4: `npm test && npx tsc --noEmit && npx eslint <changed files>`** clean.
- [ ] **Step 5: Commit** `git commit -m "feat: CRS vendor risk check gates every payment"`

---

### Task 2: Hyphenate prototype (POs, invoice match, hold, balance approval)

**Files:**
- Create: `src/integrations/hyphenate.ts`, `src/agents/finance.ts`, `src/app/api/events/[id]/invoices/route.ts`, `tests/hyphenate.test.ts`
- Modify: `src/lib/types.ts`, `src/lib/store.ts`, `src/lib/payments.ts`, `src/lib/events.ts`, `src/lib/notify.ts`, `tests/payments.test.ts`, `tests/events.test.ts`, `tests/notify.test.ts`

**Interfaces:**
- Consumes: `payVendor` with the `risk` argument from Task 1; `createApproval`, `applyReply`; `quotesToPay`; `toCents`.
- Produces:

```ts
// types.ts (replace the old Quote / Invoice / FinanceCase / ApprovalStatus types; grep first, they are unused)
export type PurchaseOrder = { id: string; eventId: string; vendorId: string; quoteCallId: string; totalCents: number;
  depositCents: number | null; status: "open" | "invoiced" | "closed"; createdAt: string };
export type Invoice = { id: string; eventId: string; vendorId: string; poId: string | null; lineItems: LineItem[];
  totalCents: number; terms: string; paymentInstructions?: string; receivedAt: string };
export type FinanceExceptionKind = "mismatch" | "payment_change" | "duplicate" | "no_po";
export type FinanceException = { id: string; eventId: string; vendorId: string; invoiceId?: string; kind: FinanceExceptionKind;
  lines: string[]; explanation: string; approver: "host" | "planner"; status: "open" | "cleared"; createdAt: string };
export type Payment = { ...existing; kind: "deposit" | "balance" };
export type Event = { ...existing; purchaseOrders: PurchaseOrder[]; invoices: Invoice[]; financeExceptions: FinanceException[] };
// store.ts: createEvent initialises the three arrays; getEvent fills them with [] when missing from an older file (one line each)
// hyphenate.ts  — // ponytail: prototype adapter; the record lives on the event. Swap this module for Hyphenate's API if they give us one. Never label the UI "Hyphenate-connected" until then.
export function createPurchaseOrders(event: Event, plan: VendorQuote[], now: Date): PurchaseOrder[];  // one per plan quote with priceUsd !== null; totalCents = toCents(priceUsd); depositCents = depositUsd ? toCents(depositUsd) : null; pushed onto event.purchaseOrders; idempotent (skip vendors that already have an open PO)
export function matchInvoice(po: PurchaseOrder, inv: Invoice, vendor: Vendor, priorInvoices: Invoice[], now: Date): { kind: FinanceExceptionKind | null; lines: string[] };
// lines: total differs → `Invoice total ${usd(inv.totalCents)} vs PO ${usd(po.totalCents)}` (kind mismatch);
// paymentInstructions present and digits(paymentInstructions) does not contain digits(vendor.phone) → "New payment details on the invoice; not the number on file" (kind payment_change, wins over mismatch);
// another invoice for the same vendor with the same totalCents within 7 days → `Possible duplicate of ${prior.id}` (kind duplicate, wins over mismatch, loses to payment_change)
export function balanceCents(po: PurchaseOrder, event: Event): number;  // po.totalCents − sum of succeeded payments for that vendor, min 0
export function openException(event: Event, vendorId: string): FinanceException | undefined;
// payments.ts
export type PayRefusal = existing | "finance_hold";
payVendor(event, store, pay, vendorId, amountCents, now, risk, kind: "deposit" | "balance" = "deposit"): refuses "finance_hold" when openException(event, vendorId); idempotency key gets ":balance" suffix for balance; Payment.kind set
// finance.ts
export const financeSpec: AgentSpec<{ explanation: string }>;   // no tools, effort low; input: PO and invoice JSON (our data) + the discrepancy lines; output one plain sentence, under 40 words, citing the numbers; never says what to do about money
export function explainDiscrepancies(po: PurchaseOrder, inv: Invoice, lines: string[], audit: AuditEvent[]): Promise<string>;  // ok → data.explanation; not ok → lines.join(" ")
// notify.ts
export function invoiceHeldText(vendor: Vendor, explanation: string): string;  // `Held ${vendor.name}'s invoice: ${explanation} A planner will follow up.`
export function balanceApprovalText(vendor: Vendor, balanceCents: number, code: string): string;  // `Invoice from ${vendor.name} matches the quote. Pay the remaining ${usd(balance)}? Reply YES ${code} or NO ${code}.`
export function invoiceSettledText(vendor: Vendor): string;  // `Invoice from ${vendor.name} matches the quote. Nothing more to pay.`
// events.ts
// paymentJob: after the status check and before runPayments → createPurchaseOrders(event, quotesToPay(event, vendors), now)
export async function receiveInvoice(eventId: string, input: { vendorId: string; lineItems: LineItem[]; terms: string; paymentInstructions?: string }, explain = explainDiscrepancies): Promise<{ invoice: Invoice; exception: FinanceException | null; approvalRequested: boolean }>;
// under the event lock: totalCents = Σ toCents(qty × unitPriceUsd); po = open PO for vendor (none → exception no_po, approver planner, explanation "No purchase order for this vendor");
// else matchInvoice → kind null: po.status = "invoiced"; balance = balanceCents; balance > 0 → createApproval(event, "payment", `${vendorId}:${po.id}`, now) + text balanceApprovalText; else text invoiceSettledText;
// kind set: explanation = await explain(...), push FinanceException (approver: payment_change → "planner", else "host"), HumanTask to planner, text invoiceHeldText. Audit "invoice_received", "invoice_held" / "invoice_matched".
// onInboundText approved branch: if the approval.kind === "payment" → detached balanceJob(eventId, approval.summary) which pays balanceCents(po) via payVendor(..., kind "balance") with a fresh ensureVendorRisk, then texts paymentText; status unchanged (still paid/done). Plan approvals behave as today.
// api route POST /api/events/:id/invoices: Zod body { vendorId: non-empty, lineItems: [{description, qty: positive, unitPriceUsd: nonnegative}] non-empty, terms: string, paymentInstructions?: string } → 201 { invoice, exception, approvalRequested }; 404 unknown event; 400 bad body
```

- [ ] **Step 1: Write failing tests.**
  `tests/hyphenate.test.ts`: `createPurchaseOrders` makes one PO per priced quote with the right cents and is idempotent; `matchInvoice` clean → `{ kind: null, lines: [] }`; total differs → mismatch line with both amounts; same total but paymentInstructions "+15559990000" vs vendor phone "+15550000001" → `payment_change`; prior invoice same total 2 days ago → `duplicate`; `balanceCents` with a $500 succeeded deposit on a $1,800 PO → 130000, with full price paid → 0.
  `tests/payments.test.ts`: open exception → `finance_hold`; balance key differs from deposit key (both succeed for the same vendor).
  `tests/events.test.ts` (no model: pass a stub `explain = async () => "stub"`): clean invoice on a PO with a deposit paid → PO `invoiced`, one pending `payment` approval, one host text containing "Pay the remaining"; clean invoice fully paid → no approval, text contains "Nothing more to pay"; mismatched invoice → one `FinanceException` with `explanation: "stub"`, one planner task, text contains "Held".
  `tests/notify.test.ts`: the three new templates' exact strings.
- [ ] **Step 2: `npm test`** → fail.
- [ ] **Step 3: Implement.** Keep `hyphenate.ts` under ~80 lines, `finance.ts` under ~30.
- [ ] **Step 4: `npm test && npx tsc --noEmit && npx eslint <changed files>`** clean.
- [ ] **Step 5: Commit** `git commit -m "feat: Hyphenate-style POs, invoice match, holds and balance approval (prototype adapter)"`
