import { test } from "node:test";
import assert from "node:assert/strict";
import * as notify from "../src/lib/notify";
import { HOST_UPDATES, summaryText, vendorQuoteText, vendorConfirmText } from "../src/lib/notify";
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
  assert.ok(s.startsWith("Here is your plan.\nVenue: Casa Verde, $1,800"));
  assert.ok(s.includes("Total $7,650 of your $12,000 budget. Deposits due now: $1,500."));
  assert.ok(s.includes("your name and phone number will be shared with these vendors"));
  assert.ok(s.includes("reply YES 4821. To cancel, reply NO 4821. This code expires in 30 minutes."));
});

test("summary with unknown price", () => {
  const s = build([1800, 4000, null]);
  assert.ok(s.includes("price is unknown") && s.includes("2 of 3"));
});

test("vendorQuoteText null price / unavailable / no date", () => {
  assert.ok(vendorQuoteText(v("a", "Flor"), q(null), brief).includes("marked it as unknown rather than guess"));
  assert.equal(vendorQuoteText(v("a", "Casa Verde"), { ...q(1800), available: false }, brief), "Casa Verde is not available on your date. I'll move to the next option.");
  assert.equal(vendorQuoteText(v("a", "Casa Verde"), q(1800), brief), "Casa Verde is available on Dec 6. Quoted price $1,800, deposit $500.");
  assert.equal(vendorQuoteText(v("a", "Casa Verde"), q(1800), { ...brief, dateWindow: null }), "Casa Verde is available. Quoted price $1,800, deposit $500.");
});

test("vendorConfirmText branches", () => {
  const ev = { brief, hostPhone: "+14155550123" } as unknown as Event;
  const p = { id: "p", amountCents: 50000, status: "succeeded", simulated: true } as Payment;
  const named = { brief, hostPhone: "+14155550123", hostName: "Priya Sharma" } as unknown as Event;
  assert.equal(vendorConfirmText(v("a", "Casa Verde"), named, { ...p, ref: "pi_123", simulated: false }),
    "Hello Casa Verde, this is Mela, an AI assistant booking for a client.\nBooking confirmed for Priya Sharma, (415) 555-0123.\nParty, Sun, Dec 6, 50 guests.\nDeposit of $500 paid (Stripe test mode), reference pi_123.");
  const ok = vendorConfirmText(v("a", "Casa Verde"), { brief, hostPhone: "+14155550123" } as unknown as Event, p);
  assert.ok(ok.includes("Booking confirmed for (415) 555-0123.") && ok.includes("Deposit of $500 paid (simulated)"));
  assert.ok(vendorConfirmText(v("a", "Casa Verde"), ev, { ...p, simulated: false }).includes("(Stripe test mode)"));
  const pend = vendorConfirmText(v("a", "Casa Verde"), ev, { ...p, status: "pending" });
  assert.ok(pend.includes("The deposit is pending") && !pend.includes("paid ("));
});

test("no template uses emoji or exclamation marks", () => {
  const ev = { brief, hostPhone: "+14155550123", payments: [] } as unknown as Event;
  const p = { id: "p", amountCents: 50000, status: "succeeded", simulated: true } as Payment;
  const texts = [build([1800, 4000, 1850]), build([1800, 4000, null]), vendorQuoteText(v("a", "X"), q(null), brief),
    notify.paymentText(v("a", "X"), p), notify.paymentText(v("a", "X"), { ...p, status: "failed" }), notify.paymentRefusedText(v("a", "X"), "over_cap"),
    vendorConfirmText(v("a", "X"), ev, p), notify.allDoneText(ev), notify.INTRO, notify.approvedText(), notify.declinedText(), notify.expiredText(),
    notify.unknownCodeText(), notify.plannerText(), notify.stopText(), notify.helpText(), ...Object.values(HOST_UPDATES).map((f) => f())];
  for (const t of texts) assert.ok(!/[\p{Extended_Pictographic}!]/u.test(t), "bad tone: " + t);
});

test("summary says when a vendor is paid in full because there is no deposit", () => {
  const vs = [v("a", "Casa Verde"), v("b", "Flor")];
  const lines = [{ vendor: vs[0], q: q(1800) }, { vendor: vs[1], q: { ...q(900), depositUsd: null } }];
  const quotes: VendorQuote[] = lines.map((l) => ({ vendorId: l.vendor.id, callId: "", extract: l.q, createdAt: "" }));
  const s = summaryText(lines, budgetCheck(brief, quotes), "1111", brief);
  assert.ok(s.includes("Due now: $1,400, including the full price for Flor, which has no deposit."));
});
