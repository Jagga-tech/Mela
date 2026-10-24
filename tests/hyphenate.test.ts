import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceCents, createPurchaseOrders, matchInvoice } from "../src/integrations/hyphenate";
import type { Event, Invoice, Payment, PurchaseOrder, Vendor, VendorQuote } from "../src/lib/types";

const now = new Date("2026-10-24T12:00:00Z");
const ev = (): Event => ({ id: "e1", hostPhone: "+15550100000", status: "approved", brief: null, missing: [], shortlist: [], calls: [],
  quotes: [], approvals: [], mandate: null, payments: [], messages: [], humanTasks: [], research: [], audit: [],
  purchaseOrders: [], invoices: [], financeExceptions: [], createdAt: "", updatedAt: "" });
const quote = (vendorId: string, priceUsd: number | null, depositUsd: number | null): VendorQuote => ({ vendorId, callId: "c-" + vendorId, createdAt: "",
  extract: { available: true, priceUsd, depositUsd, terms: [], evidence: [], openQuestions: [] } });
const vendor = { id: "v1", name: "Casa Verde", phone: "+15550000001" } as Vendor;
const po: PurchaseOrder = { id: "po1", eventId: "e1", vendorId: "v1", quoteCallId: "c-v1", totalCents: 180000, depositCents: 50000, status: "open", createdAt: "" };
const inv = (o: Partial<Invoice> = {}): Invoice => ({ id: "i1", eventId: "e1", vendorId: "v1", poId: "po1",
  lineItems: [{ description: "Venue", qty: 1, unitPriceUsd: 1800 }], totalCents: 180000, terms: "net 15", receivedAt: now.toISOString(), ...o });

test("createPurchaseOrders: one PO per priced quote, right cents, idempotent", () => {
  const e = ev();
  const plan = [quote("v1", 1800, 500), quote("v2", 900.5, null), quote("v3", null, null)];
  const made = createPurchaseOrders(e, plan, now);
  assert.equal(made.length, 2);
  assert.deepEqual(e.purchaseOrders.map((p) => [p.vendorId, p.totalCents, p.depositCents, p.status, p.quoteCallId]),
    [["v1", 180000, 50000, "open", "c-v1"], ["v2", 90050, null, "open", "c-v2"]]);
  assert.equal(createPurchaseOrders(e, plan, now).length, 0);
  assert.equal(e.purchaseOrders.length, 2);
});

test("matchInvoice clean", () => {
  assert.deepEqual(matchInvoice(po, inv(), vendor, [], now), { kind: null, lines: [] });
  assert.deepEqual(matchInvoice(po, inv({ paymentInstructions: "Zelle to (555) 000-0001" }), vendor, [], now), { kind: null, lines: [] });
});

test("matchInvoice total differs → mismatch with both amounts", () => {
  const r = matchInvoice(po, inv({ totalCents: 200000 }), vendor, [], now);
  assert.equal(r.kind, "mismatch");
  assert.deepEqual(r.lines, ["Invoice total $2,000 vs PO $1,800"]);
});

test("matchInvoice same total, different phone in instructions → payment_change, wins over mismatch", () => {
  assert.equal(matchInvoice(po, inv({ paymentInstructions: "+15559990000" }), vendor, [], now).kind, "payment_change");
  const r = matchInvoice(po, inv({ totalCents: 1, paymentInstructions: "+15559990000" }), vendor, [], now);
  assert.equal(r.kind, "payment_change");
  assert.ok(r.lines.includes("New payment details on the invoice; not the number on file"));
});

test("matchInvoice prior same-total invoice 2 days ago → duplicate; older than 7 days is not", () => {
  const prior = inv({ id: "i0", receivedAt: new Date(now.getTime() - 2 * 86400000).toISOString() });
  const r = matchInvoice(po, inv(), vendor, [prior], now);
  assert.equal(r.kind, "duplicate");
  assert.deepEqual(r.lines, ["Possible duplicate of i0"]);
  assert.equal(matchInvoice(po, inv(), vendor, [{ ...prior, receivedAt: new Date(now.getTime() - 8 * 86400000).toISOString() }], now).kind, null);
  assert.equal(matchInvoice(po, inv({ paymentInstructions: "+15559990000" }), vendor, [prior], now).kind, "payment_change");
});

test("balanceCents subtracts succeeded payments for the vendor, min 0", () => {
  const e = ev();
  const pay = (vendorId: string, amountCents: number, status: Payment["status"] = "succeeded") =>
    ({ vendorId, amountCents, status, kind: "deposit" }) as Payment;
  e.payments = [pay("v1", 50000), pay("v1", 99999, "unknown"), pay("v2", 70000)];
  assert.equal(balanceCents(po, e), 130000);
  e.payments = [pay("v1", 180000)];
  assert.equal(balanceCents(po, e), 0);
});
