// Every text Mela sends comes from here (docs/phone-plan.md "Templates"). Agents pick a template; code fills it.
// Tone: no emoji, no exclamation marks, short complete sentences. Amounts, names and dates only from event state.
import { APPROVAL_TTL_MS } from "./approvals";
import { amountToPayCents, toCents, type budgetCheck } from "./rules";
import type { Event, EventBrief, Payment, QuoteExtract, Vendor } from "./types";

export const usd = (cents: number): string => {
  const d = cents / 100;
  return "$" + d.toLocaleString("en-US", Number.isInteger(d) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
// +14155550123 → (415) 555-0123; anything else is shown as given.
const prettyPhone = (p: string) => { const d = p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p; };
const label = (p: Payment) => (p.simulated ? "simulated" : "Stripe test mode");
const CATEGORY_LABEL = { venue: "Venue", catering: "Catering", decor: "Decor" } as const;

// Prepended by sendText to the first text a host ever gets from Mela.
export const INTRO = "This is Mela, an AI planning assistant. Reply STOP at any time to stop texts.";

// T4a / T4b / T4c
export function vendorQuoteText(vendor: Vendor, q: QuoteExtract, brief: EventBrief): string {
  if (q.available === false) return `${vendor.name} is not available on your date. I'll move to the next option.`;
  if (q.priceUsd === null) return `${vendor.name} did not give a firm price, so I've marked it as unknown rather than guess.`;
  const avail = q.available === null ? `${vendor.name} has not confirmed availability.` : brief.dateWindow ? `${vendor.name} is available on ${shortDate(brief.dateWindow.start)}.` : `${vendor.name} is available.`;
  const deposit = q.depositUsd === null ? "" : `, deposit ${usd(toCents(q.depositUsd) as number)}`;
  return `${avail} Quoted price ${usd(toCents(q.priceUsd) as number)}${deposit}.`;
}

// T5: the one approval text. YES/NO + code is the only thing that books or pays.
export function summaryText(lines: { vendor: Vendor; q: QuoteExtract }[], budget: ReturnType<typeof budgetCheck>, code: string, _brief: EventBrief): string {
  const total = usd(budget.totalCents);
  const unknown = lines.filter((l) => budget.unknownVendorIds.includes(l.vendor.id)).map((l) => `${l.vendor.name}'s`);
  const totalLine = unknown.length
    ? `Total ${total} for ${lines.length - unknown.length} of ${lines.length} vendors. ${unknown.join(" and ")} price is unknown.`
    : budget.overByCents
      ? `Total ${total}, which is ${usd(budget.overByCents)} over your budget.`
      : budget.budgetCents === null ? `Total ${total}.` : `Total ${total} of your ${usd(budget.budgetCents)} budget.`;
  const due = lines.reduce((sum, l) => sum + (amountToPayCents(l.q) ?? 0), 0);
  const fullPrice = lines.filter((l) => l.q.depositUsd === null && l.q.priceUsd !== null).map((l) => l.vendor.name);
  const dueLine = fullPrice.length
    ? `Due now: ${usd(due)}, including the full price for ${fullPrice.join(" and ")}, which ${fullPrice.length === 1 ? "has" : "have"} no deposit.`
    : `Deposits due now: ${usd(due)}.`;
  return [
    "Here is your plan.",
    ...lines.map((l) => `${CATEGORY_LABEL[l.vendor.category]}: ${l.vendor.name}, ${l.q.priceUsd === null ? "price unknown" : usd(toCents(l.q.priceUsd) as number)}`),
    `${totalLine} ${dueLine}`,
    "By approving, your name and phone number will be shared with these vendors so they can reach you.",
    `To book and pay the deposits, reply YES ${code}. To cancel, reply NO ${code}. This code expires in ${APPROVAL_TTL_MS / 60000} minutes.`,
  ].join("\n");
}

export const approvedText = () => "Thank you. Your plan is approved. I'm booking the vendors and paying the deposits now."; // T6
export const declinedText = () => "Understood. Nothing has been booked or paid. A planner will contact you to adjust the plan."; // T9
export const expiredText = () => "That approval code has expired, so nothing was booked. I'll send you a new one."; // T10
export const unknownCodeText = () => "I couldn't match that code to an open request. Please reply with the code from my most recent message."; // T11
export const plannerText = () => "I've passed this to a planner on our team, who will contact you shortly."; // T15
export const stopText = () => "You won't receive any more texts from Mela. You can still follow your event on the Mela dashboard."; // T16
export const helpText = () => "This is Mela, an AI event planning assistant. Reply STOP to stop texts. To reach a person, reply PLANNER."; // T17

// T7a / T7b
export function paymentText(vendor: Vendor, p: Payment): string {
  return p.status === "succeeded"
    ? `Deposit of ${usd(p.amountCents)} paid to ${vendor.name} (${label(p)}). Reference ${p.ref ?? p.id}.`
    : `The deposit to ${vendor.name} did not go through. Nothing was retried or charged twice. A planner will check it with you.`;
}

export const paymentRefusedText = (vendor: Vendor, refusal: string) =>
  `The deposit to ${vendor.name} was not made (${refusal.replace(/_/g, " ")}). A planner will check it with you.`;

// V1: to the vendor, after the payment. Client name and number were consented to in the approval text (T5).
export function vendorConfirmText(vendor: Vendor, event: Event, p: Payment): string {
  const b = event.brief;
  const client = event.hostName ? `${event.hostName}, ${prettyPhone(event.hostPhone)}` : prettyPhone(event.hostPhone);
  const what = [b?.eventType ? b.eventType[0].toUpperCase() + b.eventType.slice(1) : "Event", b?.dateWindow ? longDate(b.dateWindow.start) : null,
    b?.guestCount ? `${b.guestCount} guests` : null].filter(Boolean).join(", ");
  const money = p.status === "succeeded"
    ? `Deposit of ${usd(p.amountCents)} paid (${label(p)}), reference ${p.ref ?? p.id}.`
    : "The deposit is pending, and we'll confirm once it is sent.";
  return [`Hello ${vendor.name}, this is Mela, an AI assistant booking for a client.`, `Booking confirmed for ${client}.`, `${what}.`, money].join("\n");
}

// T8
export function allDoneText(event: Event): string {
  const n = event.payments.filter((p) => p.status === "succeeded").length;
  return `Everything is booked: ${n} vendor${n === 1 ? "" : "s"} confirmed.`;
}

// The only texts the Lead may send on its own (notify_host). It picks the id; it never writes the words.
export const HOST_UPDATES = {
  brief_confirmed: () => "Your details are confirmed. I'm now contacting venues, caterers and decorators, and I'll text you after each conversation.", // T3
  still_working: () => "I'm still working on your plan and will text you as soon as I have an update.",
  planner_handoff: plannerText, // T15
} as const;
export type HostUpdate = keyof typeof HOST_UPDATES;
