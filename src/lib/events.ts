// Orchestrator: plain code owns the event state machine, the lock, idempotency and the gates. Agents only propose.
import { randomUUID } from "node:crypto";
import { fence, runAgent } from "@/agents/harness";
import { runIntake } from "@/agents/intake";
import { extractQuote } from "@/agents/quote";
import { DISCLOSURE } from "@/agents/outreach";
import { leadSpec, makeLeadTools, sendText, setStatus, type LeadContext } from "@/agents/lead";
import { store } from "@/lib/store";
import { applyReply, parseReply, type ReplyOutcome } from "@/lib/approvals";
import { amountToPayCents } from "@/lib/rules";
import { payVendor } from "@/lib/payments";
import { allDoneText, declinedText, expiredText, paymentText, vendorConfirmText, vendorQuoteText } from "@/lib/notify";
import { getChannel } from "@/integrations/channel";
import { getVisa } from "@/integrations/visa";
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

export async function createEvent(text: string, hostPhone: string): Promise<Event> {
  return intakeStep(await store.createEvent(hostPhone), text);
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
      approvals: event.approvals.map((a) => ({ kind: a.kind, status: a.status })) };
    const input = `${trigger}\n\nBrief:\n${JSON.stringify(event.brief)}\n\nState:\n${JSON.stringify(state)}`;
    const r = await runAgent(leadSpec(makeLeadTools(ctx)), input, event.audit);
    const inFlight = event.calls.some((c) => c.status === "placed") || event.approvals.some((a) => a.status === "pending");
    const pastApproval = ["approved", "paying", "paid", "done"].includes(event.status);
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
  for (const item of event.shortlist) {
    const q = event.quotes.find((x) => x.vendorId === item.vendorId);
    const vendor = await store.getVendor(item.vendorId);
    if (!q || !vendor || q.extract.available === false) continue;
    // payVendor mutates and saves this same event object; do not reload between vendors
    const r = await payVendor(event, store, getVisa(), vendor.id, amountToPayCents(q.extract), new Date());
    if (!r.ok) { await sendText(event, channel, event.hostPhone, `Payment to ${vendor.name} was not made (${r.refusal}).`); continue; }
    await sendText(event, channel, event.hostPhone, paymentText(vendor, r.payment));
    if (r.payment.status === "succeeded") await sendText(event, channel, vendor.phone, vendorConfirmText(vendor, event, r.payment));
  }
  setStatus(event, "paid");
  await sendText(event, channel, event.hostPhone, allDoneText(event));
  await placeHostCall(event, "host_final", { opening: DISCLOSURE, questions: [], closing: allDoneText(event) + " Thank you.", mustNotAgreeTo: [] });
}

export async function onInboundText(from: string, body: string): Promise<ReplyOutcome | "new_request"> {
  const code = parseReply(body).code;
  // a non-host sender is found by the code they quote, so they get wrong_sender instead of starting a new event
  const found = (await store.findEventByHostPhone(from)) ?? (code ? await store.findEventByPendingCode(code) : null);
  if (!found) { console.log(`[events] new_request from ${from} ignored`); return "new_request"; }
  let next: string | null = null;
  await waitLock(found.id);
  try {
    const event = await load(found.id);
    const { outcome } = applyReply(event, from, body, new Date());
    audit(event, "inbound_reply", outcome);
    if (outcome === "approved") { setStatus(event, "approved"); await runPayments(event); }
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
