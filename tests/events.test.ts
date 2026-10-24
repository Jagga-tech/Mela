import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Event } from "../src/lib/types";

// Env must be set before the store module is first loaded, so everything app-side is imported dynamically.
process.env.MELA_STORE = join(mkdtempSync(join(tmpdir(), "mela-ev-")), "store.json");
const load = async () => ({ ...(await import("@/lib/events")), ...(await import("@/lib/store")), ...(await import("@/lib/approvals")) });

const script = { opening: "", questions: [], closing: "", mustNotAgreeTo: [] };

test("markCallEnded ends once, then reports duplicate and keeps the first transcript", async () => {
  const { markCallEnded, store } = await load();
  const e: Event = await store.createEvent("+15550001234");
  e.calls.push({ id: "c1", eventId: e.id, kind: "vendor", vendorId: "venue-casa-verde", script, status: "placed", startedAt: "" });
  assert.equal(markCallEnded(e, "c1", "first"), "ended");
  assert.equal(markCallEnded(e, "c1", "second"), "duplicate");
  assert.equal(e.calls[0].transcript, "first");
  assert.equal(e.calls[0].status, "ended");
  assert.equal(markCallEnded(e, "nope", "x"), "not_found");
});

test("onInboundText from an unknown number is a new request", async () => {
  const { onInboundText } = await load();
  assert.equal(await onInboundText("+19990001111", "hi, I need a party"), "new_request");
});

test("onInboundText with the right code from the wrong number is wrong_sender and changes nothing", async () => {
  const { onInboundText, store, createApproval } = await load();
  const e = await store.createEvent("+15550002222");
  const a = createApproval(e, "plan", "s", new Date());
  await store.saveEvent(e);
  assert.equal(await onInboundText("+15550001111", "YES " + a.code), "wrong_sender");
  const after = await store.getEvent(e.id);
  assert.equal(after?.approvals[0].status, "pending");
  assert.equal(after?.status, "draft");
});

test("tryLock / unlock", async () => {
  const { tryLock, unlock, _resetLocks } = await load();
  _resetLocks();
  assert.equal(tryLock("e1"), true);
  assert.equal(tryLock("e1"), false);
  unlock("e1");
  assert.equal(tryLock("e1"), true);
  _resetLocks();
});

test("advanceStatus only moves forward; needs_planner allowed before approval", async () => {
  const { advanceStatus, store } = await load();
  const e = await store.createEvent("+15550003333");
  e.status = "awaiting_approval";
  assert.equal(advanceStatus(e, "calling"), false);
  assert.equal(e.status, "awaiting_approval");
  e.status = "calling";
  assert.equal(advanceStatus(e, "awaiting_approval"), true);
  assert.equal(e.status, "awaiting_approval");
  e.status = "calling";
  assert.equal(advanceStatus(e, "needs_planner"), true);
  e.status = "paid";
  assert.equal(advanceStatus(e, "needs_planner"), false);
});

test("quotesToPay picks one available quote per category in shortlist order", async () => {
  const { quotesToPay, store } = await load();
  const vendors = [...(await store.listVendors()),
    { id: "venue-2", name: "V2", category: "venue" as const, phone: "", capacity: 200, priceHintUsd: null, accessibility: [], dietary: [], contactFirstName: "", contactLastName: "", contactPhone: "", email: null, language: "en" as const, address: null },
    { id: "cater-2", name: "C2", category: "catering" as const, phone: "", capacity: null, priceHintUsd: null, accessibility: [], dietary: [], contactFirstName: "", contactLastName: "", contactPhone: "", email: null, language: "en" as const, address: null }];
  const e = await store.createEvent("+15550004444");
  const item = (vendorId: string) => ({ vendorId, fit: "fit" as const, conflicts: [], unknowns: [], reason: "" });
  const quote = (vendorId: string, available: boolean | null) => ({ vendorId, callId: "c-" + vendorId, createdAt: "",
    extract: { available, priceUsd: 100, depositUsd: null, terms: [], evidence: [], openQuestions: [] } });
  e.shortlist = ["venue-casa-verde", "venue-2", "cater-2", "cater-la-mesa", "decor-flor"].map(item);
  e.quotes = [quote("venue-2", true), quote("venue-casa-verde", true), quote("cater-2", false), quote("cater-la-mesa", true), quote("decor-flor", null)];
  assert.deepEqual(quotesToPay(e, vendors).map((q) => q.vendorId), ["venue-casa-verde", "cater-la-mesa", "decor-flor"]);
});

test("advanceStatus: needs_planner is terminal for automated moves; paying may fall to needs_planner", async () => {
  const { advanceStatus, store } = await load();
  const e = await store.createEvent("+15550005555");
  e.status = "needs_planner";
  assert.equal(advanceStatus(e, "calling"), false);
  assert.equal(advanceStatus(e, "paid"), false);
  assert.equal(e.status, "needs_planner");
  e.status = "paying";
  assert.equal(advanceStatus(e, "needs_planner"), true);
});

test("onInboundText with the same rowId twice: second is duplicate and adds no audit entry", async () => {
  const { onInboundText, store, createApproval } = await load();
  const e = await store.createEvent("+15550006666");
  createApproval(e, "plan", "s", new Date());
  await store.saveEvent(e);
  assert.equal(await onInboundText("+15550006666", "YES 0000", 9001), "unknown_code");
  assert.equal(await onInboundText("+15550006666", "YES 0000", 9001), "duplicate");
  const after = await store.getEvent(e.id);
  assert.equal(after?.audit.filter((a) => a.action === "inbound_reply").length, 1);
});

test("a YES after a decline does not run payments", async () => {
  const { onInboundText, store, createApproval } = await load();
  const e = await store.createEvent("+15550007777");
  const a = createApproval(e, "plan", "s", new Date());
  e.status = "needs_planner";
  await store.saveEvent(e);
  assert.equal(await onInboundText("+15550007777", "YES " + a.code), "approved");
  const after = (await store.getEvent(e.id))!;
  assert.equal(after.status, "needs_planner");
  assert.ok(after.audit.some((x) => x.action === "approval_ignored_status"));
  assert.equal(after.messages.length, 0);
  assert.equal(after.payments.length, 0);
});

test("allPaid only when every planned payment succeeded", async () => {
  const { allPaid } = await load();
  const ok = { status: "succeeded" } as Event["payments"][number];
  assert.equal(allPaid([ok, ok, ok], 3), true);
  assert.equal(allPaid([ok, ok, { ...ok, status: "unknown" }], 3), false);
  assert.equal(allPaid([ok, ok], 3), false);
  assert.equal(allPaid([], 0), false);
});

// receiveInvoice texts the host; keep the real iMessage sink out of tests
const invoiceSetup = async (phone: string, depositPaid: number) => {
  const { store, channel, createPurchaseOrders } = { ...(await load()), ...(await import("@/integrations/hyphenate")) };
  channel.text = async () => {};
  const e = await store.createEvent(phone);
  e.shortlist = [{ vendorId: "venue-casa-verde", fit: "fit", conflicts: [], unknowns: [], reason: "" }];
  e.quotes = [{ vendorId: "venue-casa-verde", callId: "c1", createdAt: "",
    extract: { available: true, priceUsd: 1800, depositUsd: 500, terms: [], evidence: [], openQuestions: [] } }];
  createPurchaseOrders(e, e.quotes, new Date());
  e.payments.push({ id: "p1", eventId: e.id, mandateId: e.mandate!.id, vendorId: "venue-casa-verde", amountCents: depositPaid,
    idempotencyKey: `${e.id}:pay:venue-casa-verde`, status: "succeeded", createdAt: "", kind: "deposit" });
  e.status = "paid";
  await store.saveEvent(e);
  return e;
};
const stub = async () => "stub";
const lines = (unitPriceUsd: number) => [{ description: "Venue", qty: 1, unitPriceUsd }];

test("receiveInvoice clean with deposit paid → PO invoiced, payment approval, host asked to pay the rest", async () => {
  const { receiveInvoice, store } = await load();
  const e = await invoiceSetup("+15550008881", 50000);
  const r = await receiveInvoice(e.id, { vendorId: "venue-casa-verde", lineItems: lines(1800), terms: "net 15" }, stub);
  assert.equal(r.exception, null); assert.equal(r.approvalRequested, true); assert.equal(r.invoice.totalCents, 180000);
  const after = (await store.getEvent(e.id))!;
  assert.equal(after.purchaseOrders[0].status, "invoiced");
  const pending = after.approvals.filter((a) => a.kind === "payment" && a.status === "pending");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].summary, `venue-casa-verde:${after.purchaseOrders[0].id}`);
  const texts = after.messages.filter((m) => m.to === after.hostPhone);
  assert.equal(texts.length, 1); assert.ok(texts[0].body.includes("Pay the remaining $1,300"));
  assert.ok(after.audit.some((a) => a.action === "invoice_matched"));
  assert.equal(after.invoices.length, 1);
});

test("receiveInvoice clean when the deposit covered the full price → no approval, nothing more to pay", async () => {
  const { receiveInvoice, store } = await load();
  const e = await invoiceSetup("+15550008882", 180000);
  const r = await receiveInvoice(e.id, { vendorId: "venue-casa-verde", lineItems: lines(1800), terms: "net 15" }, stub);
  assert.equal(r.approvalRequested, false);
  const after = (await store.getEvent(e.id))!;
  assert.equal(after.approvals.length, 0);
  assert.ok(after.messages.at(-1)!.body.includes("Nothing more to pay"));
});

test("receiveInvoice mismatch → finance exception, planner task, held text", async () => {
  const { receiveInvoice, store } = await load();
  const e = await invoiceSetup("+15550008883", 50000);
  const r = await receiveInvoice(e.id, { vendorId: "venue-casa-verde", lineItems: lines(2000), terms: "net 15" }, stub);
  assert.equal(r.approvalRequested, false); assert.equal(r.exception?.kind, "mismatch");
  const after = (await store.getEvent(e.id))!;
  assert.equal(after.financeExceptions.length, 1);
  assert.equal(after.financeExceptions[0].explanation, "stub"); assert.equal(after.financeExceptions[0].approver, "host");
  assert.equal(after.humanTasks.filter((t) => t.to === "planner").length, 1);
  assert.ok(after.messages.at(-1)!.body.includes("Held"));
  assert.equal(after.purchaseOrders[0].status, "open");
  assert.ok(after.audit.some((a) => a.action === "invoice_held"));
});

test("receiveInvoice payment_change → planner approver; no PO → no_po", async () => {
  const { receiveInvoice } = await load();
  const e = await invoiceSetup("+15550008884", 50000);
  const r = await receiveInvoice(e.id, { vendorId: "venue-casa-verde", lineItems: lines(1800), terms: "net 15", paymentInstructions: "+15559990000" }, stub);
  assert.equal(r.exception?.kind, "payment_change"); assert.equal(r.exception?.approver, "planner");
  // fixed wording; the model (here the stub) is never asked
  assert.equal(r.exception?.explanation, "The invoice carries payment details that differ from the number on file.");
  const n = await receiveInvoice(e.id, { vendorId: "decor-flor", lineItems: lines(900), terms: "" }, stub);
  assert.equal(n.exception?.kind, "no_po"); assert.equal(n.exception?.explanation, "No purchase order for this vendor");
});

test("a re-sent invoice with the same total is a duplicate", async () => {
  const { receiveInvoice } = await load();
  const e = await invoiceSetup("+15550008885", 50000);
  await receiveInvoice(e.id, { vendorId: "venue-casa-verde", lineItems: lines(1800), terms: "net 15" }, stub);
  const r = await receiveInvoice(e.id, { vendorId: "venue-casa-verde", lineItems: lines(1800), terms: "net 15" }, stub);
  assert.equal(r.exception?.kind, "duplicate");
});

test("YES to a balance approval keeps status and runs the balance through the payment gates", async () => {
  const { receiveInvoice, onInboundText, store } = await load();
  process.env.STRIPE_SECRET_KEY ??= "sk_test_x"; // the vendor check refuses before Stripe is called
  delete process.env.CRS_USERNAME; // no network: CRS unconfigured → "review"
  const e = await invoiceSetup("+15550008886", 50000);
  await receiveInvoice(e.id, { vendorId: "venue-casa-verde", lineItems: lines(1800), terms: "net 15" }, stub);
  const code = (await store.getEvent(e.id))!.approvals[0].code;
  assert.equal(await onInboundText(e.hostPhone, "YES " + code), "approved");
  let after = (await store.getEvent(e.id))!;
  for (let i = 0; i < 50 && !after.humanTasks.some((t) => t.question.startsWith("Balance")); i++) {
    await new Promise((r) => setTimeout(r, 20)); after = (await store.getEvent(e.id))!;
  }
  assert.equal(after.status, "paid");
  // no CRS credentials in tests → vendor check is "review" → the balance is refused, never paid blind
  assert.ok(after.humanTasks.some((t) => t.question.startsWith("Balance to Casa Verde not paid (vendor check not clear)")));
  assert.equal(after.payments.length, 1);
});

test("an unknown deposit holds the balance: no approval on the invoice, no payment on a YES", async () => {
  const { receiveInvoice, onInboundText, store } = await load();
  const e = await invoiceSetup("+15550008887", 50000);
  e.payments[0].status = "unknown"; await store.saveEvent(e);
  const r = await receiveInvoice(e.id, { vendorId: "venue-casa-verde", lineItems: lines(1800), terms: "net 15" }, stub);
  assert.equal(r.approvalRequested, false);
  let after = (await store.getEvent(e.id))!;
  assert.ok(after.messages.at(-1)!.body.includes("on hold until the deposit is reconciled"));
  assert.ok(after.humanTasks.some((t) => t.question === "Reconcile Casa Verde deposit before paying the balance"));

  // approval created while the deposit looked fine, then the deposit turns out unknown: the balance job still holds
  const e2 = await invoiceSetup("+15550008888", 50000);
  await receiveInvoice(e2.id, { vendorId: "venue-casa-verde", lineItems: lines(1800), terms: "net 15" }, stub);
  const cur = (await store.getEvent(e2.id))!;
  cur.payments[0].status = "unknown"; await store.saveEvent(cur);
  assert.equal(await onInboundText(cur.hostPhone, "YES " + cur.approvals[0].code), "approved");
  after = (await store.getEvent(e2.id))!;
  for (let i = 0; i < 50 && !after.audit.some((a) => a.action === "balance_blocked_unreconciled"); i++) {
    await new Promise((res) => setTimeout(res, 20)); after = (await store.getEvent(e2.id))!;
  }
  assert.ok(after.audit.some((a) => a.action === "balance_blocked_unreconciled"));
  assert.equal(after.payments.length, 1);
});
