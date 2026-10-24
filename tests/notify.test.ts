import { test } from "node:test";
import assert from "node:assert/strict";
import { allDoneText, balanceApprovalText, balanceDeclinedText, balanceHeldText, balancePaidText, invoiceHeldText, invoiceSettledText, paymentText, summaryText, vendorQuoteText, vendorConfirmText } from "../src/lib/notify";
import { budgetCheck } from "../src/lib/rules";
import type { Event, EventBrief, Payment, QuoteExtract, Vendor, VendorQuote } from "../src/lib/types";

const brief: EventBrief = { eventType: "party", location: "SF", dateWindow: { start: "2026-12-06", end: "2026-12-07" },
  guestCount: 50, budgetUsd: 12000, accessibility: [], dietary: [], preferences: [] };
const v = (id: string, name: string): Vendor => ({ id, name, category: "venue", phone: "1", capacity: null, contactFirstName: "A", contactLastName: "B", contactPhone: "1", email: null, address: null, language: "en",
  priceHintUsd: null, accessibility: [], dietary: [] });
const q = (priceUsd: number | null): QuoteExtract => ({ available: true, priceUsd, depositUsd: 500, terms: [],
  evidence: [], openQuestions: [] });
const build = (prices: (number | null)[]) => {
  const vs = [v("a", "Casa Verde"), v("b", "Tasty"), v("c", "Flor")];
  const lines = vs.map((vendor, i) => ({ vendor, q: q(prices[i]) }));
  const quotes: VendorQuote[] = lines.map((l) => ({ vendorId: l.vendor.id, callId: "", extract: l.q, createdAt: "" }));
  return summaryText(lines, budgetCheck(brief, quotes), "4821", brief);
};

test("summary with known prices", () => {
  const s = build([1800, 4000, 1850]);
  assert.ok(s.includes("$7,650") && s.includes("$12,000") && s.includes("Reply YES 4821"));
  assert.ok(s.includes("Casa Verde: available Dec 6, $1,800, deposit $500."));
});

test("summary with unknown price", () => {
  const s = build([1800, 4000, null]);
  assert.ok(s.includes("price is unknown") && s.includes("2 of 3"));
});

test("vendorQuoteText null price / unavailable / no date", () => {
  assert.ok(vendorQuoteText(v("a", "Flor"), q(null), brief).includes("price unknown"));
  assert.equal(vendorQuoteText(v("a", "Casa Verde"), { ...q(1800), available: false }, brief), "Casa Verde: not available for your dates.");
  assert.equal(vendorQuoteText(v("a", "Casa Verde"), q(1800), { ...brief, dateWindow: null }), "Casa Verde: available, $1,800, deposit $500.");
});

test("vendorConfirmText branches", () => {
  const ev = { brief } as unknown as Event;
  const p = { id: "p", amountCents: 50000, status: "succeeded" } as Payment;
  assert.ok(vendorConfirmText(v("a", "Casa Verde"), ev, p, true).includes("Deposit $500 sent (Stripe test mode)."));
  const pend = vendorConfirmText(v("a", "Casa Verde"), ev, { ...p, status: "pending" }, true);
  assert.ok(pend.includes("Payment pending.") && !pend.includes("sent"));
});

test("deposit vs full price labels", () => {
  const ev = { brief } as unknown as Event;
  const p = { id: "p", ref: "pi_1", amountCents: 90000, status: "succeeded" } as Payment;
  assert.equal(paymentText(v("c", "Flor Decor"), p, false), "Paid $900 (full price) to Flor Decor (Stripe test mode). Ref pi_1");
  assert.ok(paymentText(v("a", "Casa Verde"), { ...p, amountCents: 50000 }, true).startsWith("Paid $500 deposit to Casa Verde"));
  assert.ok(vendorConfirmText(v("c", "Flor Decor"), ev, p, false).includes("Full price $900 sent (Stripe test mode)."));
});

test("summary says what is charged now", () => {
  const vs = [v("a", "Casa Verde"), v("b", "La Mesa"), v("c", "Flor Decor")];
  const qs = [{ ...q(1800), depositUsd: 500 }, { ...q(4950), depositUsd: 1485 }, { ...q(900), depositUsd: null }];
  const lines = vs.map((vendor, i) => ({ vendor, q: qs[i] }));
  const quotes: VendorQuote[] = lines.map((l) => ({ vendorId: l.vendor.id, callId: "", extract: l.q, createdAt: "" }));
  assert.ok(summaryText(lines, budgetCheck(brief, quotes), "4821", brief)
    .includes("Charging now: $500 deposit (Casa Verde), $1,485 deposit (La Mesa), $900 full price (Flor Decor)."));
});

test("allDoneText counts bookings and says Stripe test mode", () => {
  const p = { status: "succeeded" } as Payment;
  assert.equal(allDoneText({ payments: [p, p] } as unknown as Event), "All set. 2 vendors booked. Confirmations above. (Stripe test mode)");
});

test("invoice templates", () => {
  const cv = v("a", "Casa Verde");
  assert.equal(invoiceHeldText(cv, "Total is $200 over the PO."), "Held Casa Verde's invoice: Total is $200 over the PO. A planner will follow up.");
  assert.equal(balanceApprovalText(cv, 130000, "4821"), "Invoice from Casa Verde matches the quote. Pay the remaining $1,300? Reply YES 4821 or NO 4821.");
  assert.equal(invoiceSettledText(cv), "Invoice from Casa Verde matches the quote. Nothing more to pay.");
});

test("balance templates", () => {
  const cv = v("a", "Casa Verde");
  assert.equal(balanceHeldText(cv), "The remaining balance for Casa Verde is on hold until the deposit is reconciled.");
  assert.equal(balancePaidText(cv, { id: "p", ref: "pi_9", amountCents: 130000, status: "succeeded" } as Payment),
    "Paid the remaining $1,300 to Casa Verde (Stripe test mode). Ref pi_9.");
  assert.equal(balanceDeclinedText(cv), "Got it, the balance for Casa Verde is not paid. A planner will follow up.");
});
