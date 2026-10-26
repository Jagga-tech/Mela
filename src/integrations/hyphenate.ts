// ponytail: prototype adapter; the record lives on the event. Swap this module for Hyphenate's API if they give us one. Never label the UI "Hyphenate-connected" until then.
import { randomUUID } from "node:crypto";
import { toCents } from "@/lib/rules";
import { usd } from "@/lib/notify";
import { digits } from "@/integrations/phone";
import type { Event, FinanceException, FinanceExceptionKind, Invoice, PurchaseOrder, Vendor, VendorQuote } from "@/lib/types";

const DUPLICATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// One PO per priced quote; a vendor that already has a PO that is not closed is skipped.
export function createPurchaseOrders(event: Event, plan: VendorQuote[], now: Date): PurchaseOrder[] {
  const made: PurchaseOrder[] = [];
  for (const q of plan) {
    if (q.extract.priceUsd === null || event.purchaseOrders.some((p) => p.vendorId === q.vendorId && p.status !== "closed")) continue;
    const po: PurchaseOrder = { id: randomUUID(), eventId: event.id, vendorId: q.vendorId, quoteCallId: q.callId,
      totalCents: toCents(q.extract.priceUsd)!, depositCents: q.extract.depositUsd ? toCents(q.extract.depositUsd) : null,
      status: "open", createdAt: now.toISOString() };
    event.purchaseOrders.push(po);
    made.push(po);
  }
  return made;
}

// Precedence: payment_change > duplicate > mismatch. All lines are kept for the explanation.
// The phone match uses the last 10 digits, so "(555) 000-0001" matches "+15550000001".
export function matchInvoice(po: PurchaseOrder, inv: Invoice, vendor: Vendor, priorInvoices: Invoice[], now: Date):
  { kind: FinanceExceptionKind | null; lines: string[] } {
  const lines: string[] = [];
  let kind: FinanceExceptionKind | null = null;
  if (inv.totalCents !== po.totalCents) { lines.push(`Invoice total ${usd(inv.totalCents)} vs PO ${usd(po.totalCents)}`); kind = "mismatch"; }
  const prior = priorInvoices.find((p) => p.id !== inv.id && p.vendorId === inv.vendorId && p.totalCents === inv.totalCents
    && Math.abs(now.getTime() - new Date(p.receivedAt).getTime()) < DUPLICATE_WINDOW_MS);
  if (prior) { lines.push(`Possible duplicate of ${prior.id}`); kind = "duplicate"; }
  const onFile = digits(vendor.phone).slice(-10); // empty = no number on file, so any instructions are new
  if (inv.paymentInstructions && (!onFile || !digits(inv.paymentInstructions).includes(onFile))) {
    lines.push("New payment details on the invoice; not the number on file"); kind = "payment_change";
  }
  return { kind, lines };
}

export const balanceCents = (po: PurchaseOrder, event: Event): number => Math.max(0, po.totalCents
  - event.payments.filter((p) => p.vendorId === po.vendorId && p.status === "succeeded").reduce((s, p) => s + p.amountCents, 0));

// A pending or unknown payment may already have moved money; no balance is paid until a human reconciles it.
export const hasUnreconciledPayment = (event: Event, vendorId: string): boolean =>
  event.payments.some((p) => p.vendorId === vendorId && (p.status === "pending" || p.status === "unknown"));

export const openException = (event: Event, vendorId: string): FinanceException | undefined =>
  event.financeExceptions.find((x) => x.vendorId === vendorId && x.status === "open");
