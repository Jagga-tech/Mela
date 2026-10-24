# Mela × Visa: shopping + payment plan

Draft, Oct 23 2026. Builds on `docs/multi-agent-harness.md` and `docs/hyphenate-plan.md`.

## Decision (Oct 24): host's card + spending limit, Visa agent pays vendors

- In the user flow, after the host confirms the final plan, Mela asks them to **add a card in Visa's secure form** and **set a spending limit**: total cap, which vendors, amount per payment (from the plan), end date, pause anytime.
- Mela stores only Visa's card token and limit (a standing Mandate). The card number never reaches Mela, the browser state, or Claude.
- On each due date, code checks: in the plan, under the limit, invoice matches the quote, vendor badge still Trusted (CRS under 7 days old), bank details unchanged, one-time key unused. Then the **Visa agent pays the vendor directly** from the host's card.
- Anything outside the limit (higher amount, new vendor, changed details) pauses and asks the host.
- Visa's own card authentication replaces the CRS passcode (crs-plan C3 is dropped).
- Hyphenate's role: the invoice-vs-quote match and holds before each Visa payment.
- Fallback without Visa's agent sandbox: "approved, not paid".

## Framing

Track: **Visa, Best Use of "Reimagining Shopping"** ($5,000, Cal Hacks 13.0 Devpost).

Planning an event *is* shopping: a host is buying a venue, a caterer and décor, under a budget, from vendors they don't know. Reimagined, the host says what they want, the agents shop and compare like a personal buyer, and **the host sets the spending rules once. The agent can only pay inside those rules, and code checks every payment.**

Split with Hyphenate:
- **Hyphenate** = the planner business's books: PO, bill, match, approval.
- **Visa** = the actual purchase: the cart, the host's spending rules, the payment.

Visa only runs on a bill that Hyphenate's side has cleared.

## What Visa gives us (to confirm at the booth)

- **Visa Developer MCP** (read-only docs and schemas) for building the integration from Claude Code / Cursor.
- **Visa Intelligent Commerce** and its Agent MCP for agent-initiated payments under user-set controls. It's rolling out product by product, so access needs confirming.
- **Fallback:** if no runtime sandbox is available, the payment step records *"approved, not paid"* with the exact amount and mandate. Never call it a payment if no money moved, even sandbox money.

## Use cases

Same demo numbers as the Hyphenate plan: caterer PO **$4,500**, deposit **30% = $1,350**, catering budget $5,000.

### V1. Shop-and-compare cart (the "reimagined shopping" moment)

- **Trigger:** the shortlist is published.
- **Steps:**
  1. Lead calls `build_cart(options)`, which is code. It builds 2–3 bundles: e.g. *Best fit* / *Under budget* / *Most verified*. Each bundle is venue + caterer + décor, with the total, deposit due, and what you give up.
  2. The Explainer writes one line per bundle: "Saves $600 but no step-free entrance at the side gate."
- **What people see:** dashboard cart cards with total, budget left, a verified badge per vendor (from the Bright Data → Apify check) and the trade-off line. iMessage: "3 ways to do it, from $8,900 to $11,200. Compare →"
- **Pass:** totals and budget left are computed in code (integer cents); unknown prices are shown as unknown and excluded from the totals, never guessed.

### V2. Host-approved deposit (hero, build first)

- **Trigger:** the caterer PO is approved and its bill is clean, i.e. UC1's hold has been resolved.
- **Steps:**
  1. Lead → `request_payment_approval(poId, "deposit")`. Code creates a **Mandate**: caterer, $1,350 cap, catering, expires in 48h.
  2. The host approves on the dashboard (signed in), never by phone or text reply.
  3. Lead → `pay(mandateId)`. Code checks the mandate, then calls the Visa adapter.
  4. The Payment is recorded, the ledger updated, and a receipt texted.
- **What people see:** dashboard "Pay $1,350 deposit to [caterer]" → *Approve*. iMessage: "Deposit $1,350 sent to [caterer] (Visa sandbox). Receipt →"
- **Pass:** `pay` refuses without an approved mandate; it refuses an amount over the cap, a different vendor, or an expired mandate; the same mandate can't pay twice (idempotency key); the UI and text say "sandbox".

### V3. Spending rules for small buys

- **Trigger:** the host sets a rule once, e.g. *"Décor and rentals: up to $300 total, verified vendors only, until Nov 10."*
- **Steps:** that rule is a standing Mandate. When the Lead finds a $120 balloon arch rental from a verified vendor, `pay` can run without asking again, because code checks category, total spent against the cap, vendor verified, and expiry. Anything outside the rule → a normal approval request.
- **What people see:** dashboard "Décor rule: $120 of $300 used". iMessage after each buy: "Bought balloon arch rental, $120 (rule: décor ≤ $300). Undo window 1h →"
- **Pass:** the cap is enforced across several purchases, not per purchase; an unverified vendor is refused; the host can pause the rule instantly.

### V4. Finance hold blocks payment (Hyphenate × Visa)

- **Trigger:** `pay` is called while the vendor has an open `FinanceException` (UC1 mismatch, UC2 bank change, UC3 unverified, UC4 duplicate).
- **Steps:** code refuses the payment and returns the exception ID. The Lead tells the host what has to be resolved first.
- **What people see:** dashboard "Payment blocked: invoice held for bank-detail change. Resolve →"
- **Pass:** every open exception kind blocks payment; resolving it unblocks it without a new mandate if the old one hasn't expired.

### V5. Cancel and refund (stretch)

- **Trigger:** the host cancels a vendor inside the refund window from UC5.
- **Steps:** code checks the window, then requests the refund through the Visa adapter, or records "refund requested" in fallback mode.
- **Pass:** a refund outside the window is refused with the window date shown.

### Build order

V2 → V4 → V1 → V3 → V5. V2 + V4 make the demo and show that Visa only pays what finance cleared. V1 is the shopping story for the judges, and V3 is the agentic-commerce moment.

## Harness: tools the Lead agent gets

All plain code. The Lead can ask, but code decides.

| Tool | What it does | Refuses when |
|------|--------------|--------------|
| `build_cart(options)` | Builds bundles with totals, deposits and trade-offs | – |
| `request_payment_approval(poId, kind)` | Creates a pending Mandate and puts a gate on the dashboard; the Lead's run ends | No approved PO |
| `create_spending_rule(...)` | Host-only from the dashboard. **Not** given to the Lead | – |
| `pay(mandateId, amountCents, vendorId)` | Checks the mandate, then calls `src/integrations/visa.ts` | Mandate not approved / expired / paused; amount over the remaining cap; vendor mismatch or unverified; any open FinanceException; idempotency key already used |
| `refund(paymentId)` | Calls the Visa adapter | Outside the refund window |

**Card details never touch the model or the browser.** The Visa adapter holds credentials server-side; the Lead only ever sees `mandateId` and `paymentId`.

## New records

```ts
Mandate { id, eventId, vendorId?, category, capCents, spentCents, expiresAt,
          kind: "one_time" | "standing", status: "pending" | "approved" | "paused" | "expired", approvedBy }
Payment { id, mandateId, vendorId, amountCents, idempotencyKey,
          status: "pending" | "succeeded" | "failed" | "recorded_not_paid", visaRef?, sandbox: true }
```

## Ask at the Visa booth

1. Which product counts for "Reimagining Shopping": Intelligent Commerce, a checkout sandbox, or something else?
2. Is there a runtime Agent MCP or sandbox with credentials for the hackathon, or just the docs MCP?
3. Do they want to see agent-initiated payments under user rules (V3), or is a host-approved checkout (V2) enough?
