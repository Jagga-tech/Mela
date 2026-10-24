# Mela × CRS: vendor risk + identity plan

Draft, Oct 23 2026. Builds on `docs/hyphenate-plan.md` and `docs/visa-plan.md`.

## The track

**CRS Financial Intelligence Challenge** (calhacks.crscreditapi.com). CRS is a credit reporting agency with one JSON API and an MCP server.

- **Prizes:** Best Overall CRS Hack $1,000 · **Best Financial AI Agent $500** · **Best Identity / Fraud Innovation** (interview) · Most Unexpected Use (interview).
- **Only rule:** make meaningful use of the CRS sandbox, and show it live in the demo.
- **Judged on:** originality, usefulness, CRS at the core, works end-to-end, responsible data handling.

## Framing

Before the planner business sends a deposit to a vendor it has never worked with, Mela checks **who it's paying**. CRS sits at the point where money leaves: no CRS check, no deposit. That puts CRS at the core and ties it to Hyphenate (holds) and Visa (pay).

We aim for **Best Financial AI Agent** and **Best Identity / Fraud Innovation**.

## What we use, and what we don't

| CRS API | Use | Why |
|---------|-----|-----|
| **Business credit** + state filings | Vendor risk before the first deposit | Is this a real, active business, and does the name match? |
| **Public records** (business) | Liens, judgments, bankruptcy | A caterer in bankruptcy shouldn't get a $1,350 deposit |
| **OFAC / compliance** | Screen the vendor and any new payee name | Required-style check before paying anyone |
| **IDV: OTP + device check** | Step-up check on the host before big approvals | Proves it's really the host approving, not someone with their phone number |
| ~~Consumer credit reports~~ | **Not used** | Planning a party isn't a reason to pull someone's credit. No permissible purpose |
| ~~Criminal / eviction~~ | **Not used** | Not relevant to buying catering; unfair to vendors |

This is our answer to "responsible": we use the smallest set of checks that protects the payment, and we say so in the demo.

## Use cases

### C0. Vendor reputation in the data layer (moved to the front, Oct 23)

- **Where:** in the update job, right after Bright Data (facts) and Apify (media check), **before** any vendor reaches a shortlist.
- **Steps:** for each vendor, code calls CRS (business lookup, public records, OFAC) and saves the result next to the vendor in SpacetimeDB. The Verify agent writes a short summary of praise and complaints from Apify.
- **Reputation badge, set by code from three checks:**
  - **Trusted:** CRS clear, key facts confirmed, no serious recurring complaints.
  - **Check first:** CRS review, a contradicted fact, or a recurring complaint. Shown on the shortlist with the reason.
  - **Not recommended:** CRS block (closed, bankrupt, sanctioned). Left off the shortlist ("1 caterer hidden: business closed").
- **Refresh:** CRS results older than 7 days are re-checked by the update job, and again before a first payment (C1 becomes this re-check).
- **Why at the front:** the host never falls for a vendor Mela can't pay, and the badge on every card shows CRS working in the demo.


### C1. Vendor risk check before the first deposit (hero)

- **Trigger:** the first PO to a new vendor is approved (Hyphenate step), before any Visa payment.
- **Steps:**
  1. Code calls CRS: business lookup → business credit → public records → OFAC on the business name.
  2. Code turns the results into a **risk level** using fixed rules:
     - `clear`: active business, name matches, no flags
     - `review`: name mismatch, thin file, or old judgments
     - `block`: OFAC hit, active bankruptcy, or business closed
     - **Updated Oct 24:** no such business found → `review` (Check first), not `block`, so home caterers aren't hidden
  3. The **Finance agent** explains the result in plain words, citing the CRS fields.
  4. `review` or `block` creates a `FinanceException { kind: "vendor_risk" }`. That blocks `pay()`, the same as V4 in the Visa plan.
- **What people see:**
  - Dashboard vendor card: "Business verified (CRS): active since 2019, no liens."
  - Or: "⚠️ Open judgment $12k (2025). Review before paying deposit."
  - iMessage only for `block`.
- **Pass:** risk levels come from code rules, not the model; `block` can't be cleared by the agent; every CRS call is in the audit log, with the risk level only and no raw report shown to the host.

### C2. Bank-detail change: check the new payee (with Hyphenate UC2)

- **Trigger:** UC2. An invoice arrives with new bank details.
- **Steps:** on top of the call-back to the number on file, code runs OFAC on the new payee name and checks it matches the vendor's registered business name from C1.
- **What people see:** the UC2 hold card gains "New payee name ≠ registered business name" or "Payee checks out", as one more piece of evidence for the person clearing it.
- **Pass:** a mismatch keeps the hold; a match alone does **not** clear it (a person still decides).

### C3. Host step-up verification (identity / fraud)

> **Dropped (Oct 24):** Visa's own card authentication covers this.

- **Trigger:** the host approves something big: a Mandate over $500, a standing spending rule (V3), or clearing a UC2 hold.
- **Steps:** code sends a CRS one-time passcode to the host's phone and runs a device check. The approval only counts once both pass.
- **What people see:** dashboard "Enter the code we just sent" before *Approve $1,350*.
- **Pass:** a big approval without a passed OTP is rejected by code; small approvals don't ask, to keep it low-stress.

**Possible extension:** with a passed OTP, the host could approve on the phone call itself ("read me the code"). That would answer our current rule that phone calls can't approve money. Only do this if C3 works cleanly.

### Build order

C0 → C1 (re-check) → C2 → C3. C1 is the "CRS at the core" moment; C3 is the identity/fraud entry.

## Demo vendors

Our vendors are other Cal Hacks teams, but **CRS checks run only against sandbox test businesses**. Each demo vendor in the DB is linked to one sandbox test business ID, chosen so we get one `clear`, one `review` and one `block`. We never send real teams' or people's details to CRS, and we say this out loud in the demo.

## Harness

- `src/integrations/crs.ts`: `login()` (Bearer token), `checkBusiness(name, state)`, `screenOfac(name)`, `sendOtp(phone)`, `verifyOtp(code)`. Keys stay server-side.
- `rules.ts`: `vendorRisk(crsResult) → "clear" | "review" | "block"`, plus a self-check for all three.
- New `FinanceException` kind: `"vendor_risk"`.
- The Lead gets **no** CRS tool. CRS runs automatically on PO approval, so the agent can't skip it or run it on someone it shouldn't.
- Development: the CRS MCP server (`@crscreditapi/crs-calhacks-mcp-server`) can be added to Claude Code to explore the API while building.

## To do / ask at the CRS booth

1. Get the sandbox invite (email on the challenge page), then the Postman collection.
2. Confirm the business credit, public records, OFAC and OTP endpoints are all in the sandbox.
3. Ask for test business IDs that return clean, flagged and blocked results.
4. Ask whether they care about consent and FCRA wording for vendor checks; the page doesn't say.
