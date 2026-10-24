import { test } from "node:test";
import assert from "node:assert/strict";
import { summaryText, vendorQuoteText, vendorConfirmText } from "../src/lib/notify";
import { budgetCheck } from "../src/lib/rules";
import type { Event, EventBrief, Payment, QuoteExtract, Vendor, VendorQuote } from "../src/lib/types";

const brief: EventBrief = { eventType: "party", location: "SF", dateWindow: { start: "2026-12-06", end: "2026-12-07" },
  guestCount: 50, budgetUsd: 12000, accessibility: [], dietary: [], preferences: [] };
const v = (id: string, name: string): Vendor => ({ id, name, category: "venue", phone: "1", capacity: null,
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
  const p = { id: "p", amountCents: 50000, status: "succeeded", simulated: true } as Payment;
  assert.ok(vendorConfirmText(v("a", "Casa Verde"), ev, p).includes("Deposit $500 sent (simulated)."));
  assert.ok(vendorConfirmText(v("a", "Casa Verde"), ev, { ...p, simulated: false }).includes("(Stripe test mode)"));
  const pend = vendorConfirmText(v("a", "Casa Verde"), ev, { ...p, status: "pending" });
  assert.ok(pend.includes("Payment pending.") && !pend.includes("sent"));
});
