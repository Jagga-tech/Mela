import type { EventBrief, FitStatus, QuoteExtract, Vendor, VendorQuote } from "./types";

// ponytail: containment match covers phrasing drift between intake and seed; replace with a fixed tag list if it ever hides a real gap
const missing = (need: string[], have: string[]) => {
  const h = have.map((s) => s.trim().toLowerCase());
  return need.filter((n) => {
    const x = n.trim().toLowerCase();
    return !h.some((y) => y.includes(x) || x.includes(y));
  });
};

export function checkFit(brief: EventBrief, vendor: Vendor): { fit: FitStatus; conflicts: string[]; unknowns: string[] } {
  const conflicts: string[] = [];
  const unknowns: string[] = [];
  if (brief.guestCount === null) unknowns.push("guest count unknown");
  if (vendor.capacity === null) {
    if (vendor.category === "venue") unknowns.push("capacity unknown");
  } else if (brief.guestCount !== null && vendor.capacity < brief.guestCount) {
    conflicts.push(`capacity ${vendor.capacity} is below ${brief.guestCount} guests`);
  }
  if (vendor.category === "venue") for (const a of missing(brief.accessibility, vendor.accessibility)) conflicts.push(`no ${a} access`);
  if (vendor.category === "catering") for (const d of missing(brief.dietary, vendor.dietary)) conflicts.push(`no ${d} option`);
  const fit = conflicts.length ? "conflict" : unknowns.length ? "possible" : "fit";
  return { fit, conflicts, unknowns };
}

export const toCents = (usd: number | null): number | null => (usd === null ? null : Math.round(usd * 100));

// a "no deposit" quote (0 or null) pays the quoted price, never $0
export const amountToPayCents = (e: QuoteExtract): number | null => toCents(e.depositUsd || e.priceUsd);

export function budgetCheck(brief: EventBrief, quotes: VendorQuote[]) {
  let totalCents = 0;
  const unknownVendorIds: string[] = [];
  for (const q of quotes) {
    const c = toCents(q.extract.priceUsd);
    if (c === null) unknownVendorIds.push(q.vendorId);
    else totalCents += c;
  }
  const budgetCents = toCents(brief.budgetUsd);
  const overByCents = budgetCents === null ? null : Math.max(0, totalCents - budgetCents);
  return { totalCents, unknownVendorIds, budgetCents, overByCents };
}
