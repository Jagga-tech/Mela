import { test } from "node:test";
import assert from "node:assert/strict";
import * as notify from "../src/lib/notify";
import { HOST_UPDATES, allDoneText, balanceApprovalText, balanceDeclinedText, balanceHeldText, balancePaidText, invoiceHeldText, invoiceSettledText, paymentText, summaryText, vendorQuoteText, vendorConfirmText } from "../src/lib/notify";
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
  const p = { id: "p", amountCents: 50000, status: "succeeded" } as Payment;
  const named = { brief, hostPhone: "+14155550123", hostName: "Priya Sharma" } as unknown as Event;
  assert.equal(vendorConfirmText(v("a", "Casa Verde"), named, { ...p, ref: "pi_123" }, true),
    "Hello Casa Verde, this is Mela, an AI assistant booking for a client.\nBooking confirmed for Priya Sharma, (415) 555-0123.\nParty, Sun, Dec 6, 50 guests.\nDeposit of $500 paid (Stripe test mode), reference pi_123.");
  const ok = vendorConfirmText(v("a", "Casa Verde"), ev, p, true);
  assert.ok(ok.includes("Booking confirmed for (415) 555-0123.") && ok.includes("Deposit of $500 paid (Stripe test mode)"));
  const pend = vendorConfirmText(v("a", "Casa Verde"), ev, { ...p, status: "pending" }, true);
  assert.ok(pend.includes("The deposit is pending") && !pend.includes("paid ("));
});

test("no template uses emoji or exclamation marks", () => {
  const ev = { brief, hostPhone: "+14155550123", payments: [] } as unknown as Event;
  const p = { id: "p", amountCents: 50000, status: "succeeded" } as Payment;
  const cv = v("a", "X");
  const texts = [build([1800, 4000, 1850]), build([1800, 4000, null]), vendorQuoteText(cv, q(null), brief),
    paymentText(cv, p, true), paymentText(cv, { ...p, status: "failed" }, false), notify.paymentRefusedText(cv, "over the spending limit"),
    vendorConfirmText(cv, ev, p, true), allDoneText(ev), notify.INTRO, notify.approvedText(), notify.declinedText(), notify.expiredText(),
    notify.unknownCodeText(), notify.needsAttentionText(), notify.plannerText(), notify.stopText(), notify.helpText(), ...Object.values(HOST_UPDATES).map((f) => f()),
    invoiceHeldText(cv, "Total differs."), balanceApprovalText(cv, 1000, "1234"), invoiceSettledText(cv), balanceHeldText(cv), balancePaidText(cv, p), balanceDeclinedText(cv)];
  for (const t of texts) assert.ok(!/[\p{Extended_Pictographic}!]/u.test(t), "bad tone: " + t);
});

test("summary says when a vendor is paid in full because there is no deposit", () => {
  const vs = [v("a", "Casa Verde"), v("b", "Flor")];
  const lines = [{ vendor: vs[0], q: q(1800) }, { vendor: vs[1], q: { ...q(900), depositUsd: null } }];
  const quotes: VendorQuote[] = lines.map((l) => ({ vendorId: l.vendor.id, callId: "", extract: l.q, createdAt: "" }));
  const s = summaryText(lines, budgetCheck(brief, quotes), "1111", brief);
  assert.ok(s.includes("Due now: $1,400, including the full price for Flor, which has no deposit."));
});

test("deposit vs full price labels", () => {
  const ev = { brief, hostPhone: "+14155550123" } as unknown as Event;
  const p = { id: "p", ref: "pi_1", amountCents: 90000, status: "succeeded" } as Payment;
  assert.equal(paymentText(v("c", "Flor Decor"), p, false), "Full price of $900 paid to Flor Decor (Stripe test mode). Reference pi_1.");
  assert.ok(paymentText(v("a", "Casa Verde"), { ...p, amountCents: 50000 }, true).startsWith("Deposit of $500 paid to Casa Verde"));
  assert.ok(paymentText(v("a", "Casa Verde"), { ...p, status: "unknown" }, false).startsWith("The payment to Casa Verde did not go through."));
  assert.ok(vendorConfirmText(v("c", "Flor Decor"), ev, p, false).includes("Full price of $900 paid (Stripe test mode)"));
});

test("summary says what is charged now across deposits and a full price", () => {
  const vs = [v("a", "Casa Verde"), v("b", "La Mesa"), v("c", "Flor Decor")];
  const qs = [{ ...q(1800), depositUsd: 500 }, { ...q(4950), depositUsd: 1485 }, { ...q(900), depositUsd: null }];
  const lines = vs.map((vendor, i) => ({ vendor, q: qs[i] }));
  const quotes: VendorQuote[] = lines.map((l) => ({ vendorId: l.vendor.id, callId: "", extract: l.q, createdAt: "" }));
  assert.ok(summaryText(lines, budgetCheck(brief, quotes), "4821", brief)
    .includes("Due now: $2,885, including the full price for Flor Decor, which has no deposit."));
});

test("allDoneText counts bookings", () => {
  const p = { status: "succeeded" } as Payment;
  assert.equal(allDoneText({ payments: [p, p] } as unknown as Event), "Everything is booked: 2 vendors confirmed.");
  assert.equal(allDoneText({ payments: [p, { status: "unknown" }] } as unknown as Event), "Everything is booked: 1 vendor confirmed.");
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
