import { toCents, type budgetCheck } from "./rules";
import type { Event, EventBrief, Payment, QuoteExtract, Vendor } from "./types";

export const usd = (cents: number): string => {
  const d = cents / 100;
  return "$" + d.toLocaleString("en-US", Number.isInteger(d) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function vendorQuoteText(vendor: Vendor, q: QuoteExtract, brief: EventBrief): string {
  if (q.available === false) return `${vendor.name}: not available for your dates.`;
  if (q.priceUsd === null) return `${vendor.name}: price unknown, I'll flag it.`;
  const avail = q.available === null ? "availability unconfirmed" : brief.dateWindow ? `available ${shortDate(brief.dateWindow.start)}` : "available";
  const deposit = q.depositUsd === null ? "" : `, deposit ${usd(toCents(q.depositUsd) as number)}`;
  return `${vendor.name}: ${avail}, ${usd(toCents(q.priceUsd) as number)}${deposit}.`;
}

export function summaryText(lines: { vendor: Vendor; q: QuoteExtract }[], budget: ReturnType<typeof budgetCheck>, code: string, brief: EventBrief): string {
  const total = usd(budget.totalCents);
  const unknown = lines.filter((l) => budget.unknownVendorIds.includes(l.vendor.id)).map((l) => `${l.vendor.name}'s`);
  const totalLine = unknown.length
    ? `Total ${total} for ${lines.length - unknown.length} of ${lines.length} vendors; ${unknown.join(" and ")} price is unknown.`
    : budget.overByCents
      ? `Total ${total}, over budget by ${usd(budget.overByCents)}.`
      : budget.budgetCents === null ? `Total ${total}.` : `Total ${total} of your ${usd(budget.budgetCents)} budget.`;
  return [...lines.map((l) => vendorQuoteText(l.vendor, l.q, brief)), totalLine, `Reply YES ${code} to book all three, or NO ${code}.`].join("\n");
}

export const declinedText = () => "Got it, nothing is booked. A planner will follow up.";
export const expiredText = () => "That code has expired. I'll send a fresh one.";

export function paymentText(vendor: Vendor, p: Payment): string {
  return p.status === "succeeded"
    ? `Paid ${usd(p.amountCents)} deposit to ${vendor.name} (simulated). Ref ${p.ref ?? p.id}`
    : `Payment to ${vendor.name} didn't confirm. Nothing was retried; please check.`;
}

export function vendorConfirmText(vendor: Vendor, event: Event, p: Payment): string {
  const w = event.brief?.dateWindow;
  const base = `Booking confirmed for ${event.brief?.eventType ?? "your event"}${w ? ` on ${shortDate(w.start)}` : ""} with ${vendor.name}.`;
  return p.status === "succeeded"
    ? `${base} Deposit ${usd(p.amountCents)} sent (${p.simulated ? "simulated" : "sandbox"}).`
    : `${base} Payment pending.`;
}

export function allDoneText(event: Event): string {
  const n = event.payments.filter((p) => p.status === "succeeded").length;
  return `All set. ${n} vendor${n === 1 ? "" : "s"} booked. Confirmations above.`;
}
