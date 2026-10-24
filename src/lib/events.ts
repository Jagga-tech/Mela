// Orchestrator: plain code owns the event state machine, the lock, idempotency and the gates. Agents only propose.
import { randomUUID } from "node:crypto";
import { fence, runAgent } from "@/agents/harness";
import { runIntake } from "@/agents/intake";
import { extractQuote } from "@/agents/quote";
import { DISCLOSURE } from "@/agents/outreach";
import { isPastApproval, leadSpec, makeLeadTools, quotesToPay, sendText, setStatus, type LeadContext } from "@/agents/lead";
export { advanceStatus, quotesToPay } from "@/agents/lead";
import { store } from "@/lib/store";
import { applyReply, isHostNumber, parseReply, type ReplyOutcome } from "@/lib/approvals";
import { amountToPayCents } from "@/lib/rules";
import { payVendor } from "@/lib/payments";
import { allDoneText, approvedText, declinedText, expiredText, helpText, paymentRefusedText, paymentText, plannerText, stopText, unknownCodeText, vendorConfirmText, vendorQuoteText } from "@/lib/notify";
import { getChannel } from "@/integrations/channel";
import { getPayAdapter } from "@/integrations/pay";
import type { CallKind, CallScript, Event, EventBrief } from "@/lib/types";

export const channel = getChannel(onCallEnded, store);

// ponytail: in-process lock, one Node process only; move to a store-level lease if we ever run more than one
const locks = new Set<string>();
export const tryLock = (id: string) => (locks.has(id) ? false : (locks.add(id), true));
export const unlock = (id: string) => void locks.delete(id);
export const _resetLocks = () => locks.clear();
const waitLock = async (id: string) => { while (!tryLock(id)) await new Promise((r) => setTimeout(r, 100)); };

const audit = (e: Event, action: string, detail?: string) => e.audit.push({ at: new Date().toISOString(), actor: "orchestrator", action, detail });
const planner = (e: Event, question: string, why: string) =>
  e.humanTasks.push({ id: randomUUID(), eventId: e.id, to: "planner", question, why, status: "open" });
const load = async (id: string) => { const e = await store.getEvent(id); if (!e) throw new Error("event not found: " + id); return e; };

export function markCallEnded(event: Event, callId: string, transcript: string): "ended" | "duplicate" | "not_found" {
  const call = event.calls.find((c) => c.id === callId);
  if (!call) return "not_found";
  if (call.status === "ended") return "duplicate";
  Object.assign(call, { status: "ended", transcript, endedAt: new Date().toISOString() });
  return "ended";
}

async function placeHostCall(event: Event, kind: Exclude<CallKind, "vendor">, script: CallScript) {
  const { callId } = await channel.callHost(event.id, kind, script);
  event.calls.push({ id: callId, eventId: event.id, kind, script, status: "placed", startedAt: new Date().toISOString() });
  await store.saveEvent(event); // persist before the call-ended webhook looks the call up
}

const briefSentence = (b: EventBrief) =>
  [`a ${b.eventType} in ${b.location}`, b.dateWindow && `on ${b.dateWindow.start}`, b.guestCount !== null && `for ${b.guestCount} guests`,
    b.budgetUsd !== null && `with a $${b.budgetUsd} budget`].filter(Boolean).join(" ");

async function startConfirmCall(event: Event) {
  setStatus(event, "confirming");
  await placeHostCall(event, "host_confirm", { opening: DISCLOSURE, mustNotAgreeTo: [], closing: "Thanks, I'll start calling vendors.",
    questions: [`Here is what I have: ${briefSentence(event.brief!)}. Is that right, or would you like to change anything?`] });
}

async function intakeStep(event: Event, text: string) {
  const r = await runIntake(text, event.brief, event.audit);
  if (!r.ok) {
    planner(event, "Intake failed: " + r.reason, "host request could not be read");
    setStatus(event, "needs_planner");
  } else {
    event.brief = r.data.brief;
    event.missing = r.data.missing;
  }
  await store.saveEvent(event);
  if (r.ok && !event.missing.length) await startConfirmCall(event);
  return event;
}

export async function createEvent(text: string, hostPhone: string, hostName?: string): Promise<Event> {
  return intakeStep(await store.createEvent(hostPhone, hostName), text);
}

export async function answerEvent(id: string, text: string): Promise<Event> {
  const event = await load(id);
  if (event.status !== "draft") { audit(event, "answer_ignored", event.status); await store.saveEvent(event); return event; }
  return intakeStep(event, text);
}

export async function startLeadRun(eventId: string, trigger: string): Promise<Event> {
  if (!tryLock(eventId)) {
    // not saved: the lock holder has the live copy and would overwrite it anyway
    const e = await load(eventId);
    audit(e, "lead_run_skipped_locked", trigger);
    return e;
  }
  try {
    const event = await load(eventId);
    const ctx: LeadContext = { event, store, channel, audit: event.audit };
    const state = { status: event.status, shortlist: event.shortlist,
      quotes: event.quotes.map((q) => ({ vendorId: q.vendorId, priceUsd: q.extract.priceUsd, depositUsd: q.extract.depositUsd, available: q.extract.available })),
      approvals: event.approvals.map((a) => ({ kind: a.kind, status: a.status })),
      calls: event.calls.map((c) => ({ kind: c.kind, vendorId: c.vendorId, status: c.status })) };
    const input = `${trigger}\n\nBrief:\n${JSON.stringify(event.brief)}\n\nState:\n${JSON.stringify(state)}`;
    const r = await runAgent(leadSpec(makeLeadTools(ctx)), input, event.audit);
    const inFlight = event.calls.some((c) => c.status === "placed") || event.approvals.some((a) => a.status === "pending");
    const pastApproval = isPastApproval(event);
    if (!r.ok || r.data.status === "blocked" || (r.data.status === "waiting" && !ctx.ended && !inFlight && !pastApproval)) {
      planner(event, `Lead run failed: ${r.ok ? r.data.summary : r.reason + (r.detail ? " " + r.detail : "")}`, trigger.slice(0, 200));
      if (!inFlight && !pastApproval) setStatus(event, "needs_planner");
    }
    await store.saveEvent(event);
    return event;
  } finally {
    unlock(eventId);
  }
}

export async function onCallEnded(callId: string, transcript: string): Promise<void> {
  const found = await store.findEventByCallId(callId);
  if (!found) { console.warn(`[events] call ended for unknown call ${callId}`); return; }
  let next: string | null = null;
  await waitLock(found.id);
  try {
    const event = await load(found.id);
    const mark = markCallEnded(event, callId, transcript);
    if (mark !== "ended") { audit(event, "call_ended_" + mark, callId); await store.saveEvent(event); return; }
    const call = event.calls.find((c) => c.id === callId)!;
    if (call.kind === "host_confirm") {
      const r = await runIntake(transcript, event.brief, event.audit);
      if (r.ok) { event.brief = r.data.brief; event.missing = r.data.missing; } else audit(event, "confirm_intake_failed", "kept prior brief");
      setStatus(event, "confirmed");
      next = "brief confirmed";
    } else if (call.kind === "vendor") {
      const vendor = await store.getVendor(call.vendorId!);
      if (!vendor) audit(event, "vendor_missing", call.vendorId);
      else {
        const r = await extractQuote(transcript, vendor, event.audit);
        const extract = r.ok ? r.data : { available: null, priceUsd: null, depositUsd: null, terms: [], evidence: [], openQuestions: ["extraction failed"] };
        event.quotes.push({ vendorId: vendor.id, callId, extract, createdAt: new Date().toISOString() });
        await sendText(event, channel, event.hostPhone, vendorQuoteText(vendor, extract, event.brief!));
        // Stripe-keyed runs: text the vendor a one-time payout setup link so the deposit can reach them
        const link = await getPayAdapter().onboardingLink?.(vendor.id, vendor.name).catch((e: unknown) => { audit(event, "vendor_onboarding_link_failed", String(e instanceof Error ? e.message : e)); return null; });
        if (link) await sendText(event, channel, vendor.phone, `This is Mela, an AI planning assistant, for ${vendor.name}. To receive your deposit, set up payouts with Stripe here (takes a minute, link expires in 5): ${link}`);
      }
      next = "vendor call ended: " + call.vendorId;
    } else setStatus(event, "done");
    await store.saveEvent(event);
  } finally {
    unlock(found.id);
  }
  if (next) await startLeadRun(found.id, next);
}

async function runPayments(event: Event) {
  setStatus(event, "paying");
  await store.saveEvent(event);
  const vendors = await store.listVendors();
  for (const q of quotesToPay(event, vendors)) {
    const vendor = vendors.find((v) => v.id === q.vendorId)!;
    // payVendor mutates and saves this same event object; do not reload between vendors
    const r = await payVendor(event, store, getPayAdapter(), vendor.id, amountToPayCents(q.extract), new Date());
    if (!r.ok) { await sendText(event, channel, event.hostPhone, paymentRefusedText(vendor, r.refusal)); continue; }
    await sendText(event, channel, event.hostPhone, paymentText(vendor, r.payment));
    if (r.payment.status === "succeeded") await sendText(event, channel, vendor.phone, vendorConfirmText(vendor, event, r.payment));
  }
  setStatus(event, "paid");
  await sendText(event, channel, event.hostPhone, allDoneText(event));
  await placeHostCall(event, "host_final", { opening: DISCLOSURE, questions: [], closing: allDoneText(event) + " Thank you.", mustNotAgreeTo: [] });
}

const KEYWORDS = { stop: "stop", unsubscribe: "stop", cancel: "stop", help: "help", planner: "planner" } as const;
export type InboundOutcome = ReplyOutcome | "new_request" | "stop" | "help" | "planner";

export async function onInboundText(from: string, body: string): Promise<InboundOutcome> {
  const code = parseReply(body).code;
  // a non-host sender is found by the code they quote, so they get wrong_sender instead of starting a new event
  const found = (await store.findEventByHostPhone(from)) ?? (code ? await store.findEventByPendingCode(code) : null);
  if (!found) { console.log(`[events] new_request from ${from} ignored`); return "new_request"; }
  let next: string | null = null;
  await waitLock(found.id);
  try {
    const event = await load(found.id);
    // STOP / HELP / PLANNER come first and only count from the host's own number.
    const keyword = KEYWORDS[body.trim().toLowerCase().replace(/[^a-z]/g, "") as keyof typeof KEYWORDS];
    if (keyword && isHostNumber(from, event.hostPhone)) {
      audit(event, "inbound_keyword", keyword);
      if (keyword === "stop") { await sendText(event, channel, event.hostPhone, stopText()); event.textsStopped = true; }
      else if (keyword === "help") await sendText(event, channel, event.hostPhone, helpText());
      else { planner(event, "Host asked for a person by text", body.slice(0, 200)); await sendText(event, channel, event.hostPhone, plannerText()); }
      await store.saveEvent(event);
      return keyword;
    }
    const { outcome } = applyReply(event, from, body, new Date());
    audit(event, "inbound_reply", outcome);
    if (outcome === "approved") { await sendText(event, channel, event.hostPhone, approvedText()); setStatus(event, "approved"); await runPayments(event); }
    else if (outcome === "unknown_code") await sendText(event, channel, event.hostPhone, unknownCodeText());
    else if (outcome === "declined") { await sendText(event, channel, event.hostPhone, declinedText()); setStatus(event, "needs_planner"); }
    else if (outcome === "expired") { await sendText(event, channel, event.hostPhone, expiredText()); next = "approval expired"; }
    else if (outcome === "no_code") next = "host said: " + fence("host_message", body);
    await store.saveEvent(event);
    return outcome;
  } finally {
    unlock(found.id);
    if (next) await startLeadRun(found.id, next);
  }
}
