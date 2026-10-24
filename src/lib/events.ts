// Orchestrator: plain code owns the event state machine, the lock, idempotency and the gates. Agents only propose.
import { randomUUID } from "node:crypto";
import { fence, runAgent } from "@/agents/harness";
import { runIntake } from "@/agents/intake";
import { extractQuote } from "@/agents/quote";
import { translate } from "@/agents/translator";
import { asLanguage, DISCLOSURES } from "@/lib/i18n";
import { isPastApproval, leadSpec, makeLeadTools, quotesToPay, sendText, setStatus, type LeadContext } from "@/agents/lead";
export { advanceStatus, quotesToPay } from "@/agents/lead";
import { store } from "@/lib/store";
import { applyReply, createApproval, parseReply, type ReplyOutcome } from "@/lib/approvals";
import { amountToPayCents, toCents } from "@/lib/rules";
import { ensureVendorRisk } from "@/lib/vendorRisk";
import { payVendor, type PayRefusal } from "@/lib/payments";
import { allDoneText, balanceApprovalText, balanceDeclinedText, balanceHeldText, balancePaidText, declinedText, expiredText, invoiceHeldText, invoiceSettledText, needsAttentionText, paymentText,
  vendorConfirmText, vendorQuoteText } from "@/lib/notify";
import { getChannel } from "@/integrations/channel";
import { getPayAdapter } from "@/integrations/pay";
import { balanceCents, createPurchaseOrders, hasUnreconciledPayment, matchInvoice } from "@/integrations/hyphenate";
import { explainDiscrepancies } from "@/agents/finance";
import { normalizePhone } from "@/integrations/phone";
import type { CallKind, CallScript, Event, EventBrief, FinanceException, Invoice, LineItem, Payment, Vendor } from "@/lib/types";

export const channel = getChannel(onCallEnded, store);

// ponytail: in-process lock, one Node process only; move to a store-level lease if we ever run more than one
// kept on globalThis so Next dev hot reload does not drop held locks
const g = globalThis as typeof globalThis & { __melaLocks?: Set<string> };
const locks = (g.__melaLocks ??= new Set<string>());
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
  const { callId, providerCallId } = await channel.callHost(event.id, kind, script, event.audit);
  event.calls.push({ id: callId, providerCallId, eventId: event.id, kind, script, status: "placed", startedAt: new Date().toISOString() });
  await store.saveEvent(event); // persist before the call-ended webhook looks the call up
}

const briefSentence = (b: EventBrief) =>
  [`a ${b.eventType} in ${b.location}`, b.dateWindow && `on ${b.dateWindow.start}`, b.guestCount !== null && `for ${b.guestCount} guests`,
    b.budgetUsd !== null && `with a $${b.budgetUsd} budget`].filter(Boolean).join(" ");

async function startConfirmCall(event: Event) {
  setStatus(event, "confirming");
  const q = `Here is what I have: ${briefSentence(event.brief!)}. Is that right, or would you like to change anything?`;
  await placeHostCall(event, "host_confirm", { opening: DISCLOSURES[event.language], mustNotAgreeTo: [],
    closing: await translate("Thanks, I'll start calling vendors.", event.language, event.audit), questions: [await translate(q, event.language, event.audit)] });
}

async function intakeStep(event: Event, text: string, detectLanguage = false) {
  const r = await runIntake(text, event.brief, event.audit);
  if (!r.ok) {
    planner(event, "Intake failed: " + r.reason, "host request could not be read");
    setStatus(event, "needs_planner");
  } else {
    event.brief = r.data.brief;
    event.missing = r.data.missing;
    if (detectLanguage) event.language = asLanguage(r.data.language);
  }
  await store.saveEvent(event);
  if (r.ok && !event.missing.length) await startConfirmCall(event);
  return event;
}

// language: the form's choice wins; otherwise Intake detects it from the first message (answers never change it).
export async function createEvent(text: string, hostPhone: string, language?: string): Promise<Event> {
  const phone = normalizePhone(hostPhone);
  if (!phone) throw new Error("hostPhone needs at least 10 digits");
  const event = await store.createEvent(phone);
  if (language) event.language = asLanguage(language);
  return intakeStep(event, text, !language);
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
      }
      next = "vendor call ended: " + call.vendorId;
    } else setStatus(event, "done");
    await store.saveEvent(event);
  } finally {
    unlock(found.id);
  }
  if (next) await startLeadRun(found.id, next);
}

const REFUSAL_WORDS: Record<PayRefusal, string> = { over_cap: "over the spending limit", amount_unknown: "price unknown",
  duplicate: "already paid", no_mandate: "payment setup problem", mandate_not_approved: "payment setup problem",
  mandate_expired: "payment setup problem", vendor_not_in_mandate: "payment setup problem", vendor_risk: "vendor check not clear", finance_hold: "invoice on hold" };

export const allPaid = (payments: Payment[], planned: number) =>
  planned > 0 && payments.filter((p) => p.status === "succeeded").length === planned;

async function runPayments(event: Event) {
  setStatus(event, "paying");
  await store.saveEvent(event);
  const vendors = await store.listVendors();
  const plan = quotesToPay(event, vendors);
  for (const q of plan) {
    const vendor = vendors.find((v) => v.id === q.vendorId)!;
    const isDeposit = !!q.extract.depositUsd; // same rule as amountToPayCents
    const now = new Date();
    const risk = await ensureVendorRisk(event, vendor, now);
    // payVendor mutates and saves this same event object; do not reload between vendors
    const r = await payVendor(event, store, getPayAdapter(), vendor.id, amountToPayCents(q.extract), now, risk);
    if (!r.ok && r.refusal === "vendor_risk") planner(event, `Vendor check for ${vendor.name}: ${risk.reasons.join("; ")}`, "payment run");
    if (!r.ok) { await sendText(event, channel, event.hostPhone, `Payment to ${vendor.name} was not made (${REFUSAL_WORDS[r.refusal]}).`); continue; }
    await sendText(event, channel, event.hostPhone, paymentText(vendor, r.payment, isDeposit));
    if (r.payment.status === "succeeded") await sendText(event, channel, vendor.phone, vendorConfirmText(vendor, event, r.payment, isDeposit), vendor.language);
  }
  if (!allPaid(event.payments, plan.length)) {
    planner(event, "Some payments did not complete; reconcile and finish booking", "payment run");
    setStatus(event, "needs_planner");
    await sendText(event, channel, event.hostPhone, needsAttentionText());
    await store.saveEvent(event);
    return; // no "All set" call
  }
  setStatus(event, "paid");
  await sendText(event, channel, event.hostPhone, allDoneText(event));
  await placeHostCall(event, "host_final", { opening: DISCLOSURES[event.language], questions: [],
    closing: await translate(allDoneText(event) + " Thank you.", event.language, event.audit), mustNotAgreeTo: [] });
}

// Runs detached after onInboundText returns, so it takes the lock itself.
async function paymentJob(eventId: string) {
  await waitLock(eventId);
  try {
    const event = await load(eventId);
    if (event.status !== "approved") { audit(event, "payments_skipped_status", event.status); await store.saveEvent(event); return; }
    createPurchaseOrders(event, quotesToPay(event, await store.listVendors()), new Date());
    await runPayments(event);
  } finally {
    unlock(eventId);
  }
}

async function holdBalance(event: Event, vendor: Vendor) {
  audit(event, "balance_blocked_unreconciled", vendor.id);
  planner(event, `Reconcile ${vendor.name} deposit before paying the balance`, "balance payment");
  await sendText(event, channel, event.hostPhone, balanceHeldText(vendor));
}

// The balance after a clean invoice; the host approved it with a "payment" approval whose summary is `${vendorId}:${poId}`.
async function balanceJob(eventId: string, summary: string) {
  await waitLock(eventId);
  try {
    const event = await load(eventId);
    const po = event.purchaseOrders.find((p) => p.id === summary.split(":").at(-1));
    const vendor = po && await store.getVendor(po.vendorId);
    if (!po || !vendor) { audit(event, "balance_po_missing", summary); await store.saveEvent(event); return; }
    const due = balanceCents(po, event);
    if (hasUnreconciledPayment(event, vendor.id)) await holdBalance(event, vendor);
    else if (!due) {
      audit(event, "balance_nothing_due", po.id);
      await sendText(event, channel, event.hostPhone, invoiceSettledText(vendor));
    } else {
      const now = new Date();
      const risk = await ensureVendorRisk(event, vendor, now);
      const r = await payVendor(event, store, getPayAdapter(), vendor.id, due, now, risk, "balance");
      if (!r.ok) {
        planner(event, `Balance to ${vendor.name} not paid (${REFUSAL_WORDS[r.refusal]})${r.refusal === "vendor_risk" ? ": " + risk.reasons.join("; ") : ""}`, "balance payment");
        await sendText(event, channel, event.hostPhone, `Payment to ${vendor.name} was not made (${REFUSAL_WORDS[r.refusal]}).`);
      } else if (r.payment.status === "succeeded") {
        po.status = "closed";
        await sendText(event, channel, event.hostPhone, balancePaidText(vendor, r.payment));
      } else {
        planner(event, "Some payments did not complete; reconcile and finish booking", "balance payment");
        await sendText(event, channel, event.hostPhone, paymentText(vendor, r.payment, false));
      }
    }
    await store.saveEvent(event);
  } finally {
    unlock(eventId);
  }
}

const PAYMENT_CHANGE_EXPLANATION = "The invoice carries payment details that differ from the number on file.";

export type InvoiceInput = { vendorId: string; lineItems: LineItem[]; terms: string; paymentInstructions?: string };

export async function receiveInvoice(eventId: string, input: InvoiceInput, explain = explainDiscrepancies):
  Promise<{ invoice: Invoice; exception: FinanceException | null; approvalRequested: boolean }> {
  await waitLock(eventId);
  try {
    const event = await load(eventId);
    const vendor = await store.getVendor(input.vendorId);
    if (!vendor) throw new Error("vendor not found: " + input.vendorId);
    const now = new Date();
    // an invoiced (not closed) PO still matches, so a re-sent invoice is caught as a duplicate instead of "no PO"
    const po = event.purchaseOrders.findLast((p) => p.vendorId === vendor.id && p.status !== "closed");
    const invoice: Invoice = { id: randomUUID(), eventId, vendorId: vendor.id, poId: po?.id ?? null, lineItems: input.lineItems,
      totalCents: input.lineItems.reduce((s, l) => s + toCents(l.qty * l.unitPriceUsd)!, 0), terms: input.terms,
      paymentInstructions: input.paymentInstructions, receivedAt: now.toISOString() };
    const prior = [...event.invoices];
    event.invoices.push(invoice);
    audit(event, "invoice_received", `${vendor.id} ${invoice.totalCents}`);
    const m = po ? matchInvoice(po, invoice, vendor, prior, now) : { kind: "no_po" as const, lines: ["No purchase order for this vendor"] };
    let exception: FinanceException | null = null, approvalRequested = false;
    if (po && m.kind === null) {
      po.status = "invoiced";
      const due = balanceCents(po, event);
      audit(event, "invoice_matched", `${vendor.id} balance ${due}`);
      if (hasUnreconciledPayment(event, vendor.id)) await holdBalance(event, vendor);
      else if (due > 0) {
        const a = createApproval(event, "payment", `${vendor.id}:${po.id}`, now);
        approvalRequested = true;
        await sendText(event, channel, event.hostPhone, balanceApprovalText(vendor, due, a.code));
      } else await sendText(event, channel, event.hostPhone, invoiceSettledText(vendor));
    } else {
      const kind = m.kind!;
      // payment_change never goes to the model: vendor-controlled payment text must not shape what the host reads
      const explanation = kind === "payment_change" ? PAYMENT_CHANGE_EXPLANATION
        : po ? await explain(po, invoice, m.lines, event.audit) : m.lines[0];
      exception = { id: randomUUID(), eventId, vendorId: vendor.id, invoiceId: invoice.id, kind, lines: m.lines, explanation,
        approver: kind === "payment_change" || kind === "no_po" ? "planner" : "host", status: "open", createdAt: now.toISOString() };
      event.financeExceptions.push(exception);
      audit(event, "invoice_held", `${vendor.id} ${kind}`);
      planner(event, `Invoice from ${vendor.name} held (${kind}): ${m.lines.join("; ")}`, "invoice match");
      await sendText(event, channel, event.hostPhone, invoiceHeldText(vendor, explanation));
    }
    await store.saveEvent(event);
    return { invoice, exception, approvalRequested };
  } finally {
    unlock(eventId);
  }
}

export type InboundOutcome = ReplyOutcome | "new_request" | "duplicate";

export async function onInboundText(from: string, body: string, rowId?: number): Promise<InboundOutcome> {
  // the poller replays a row it could not confirm; each chat.db row is handled once
  if (rowId !== undefined && !(await store.claimIdempotencyKey(`inbound:${rowId}`))) return "duplicate";
  const code = parseReply(body).code;
  // a non-host sender is found by the code they quote, so they get wrong_sender instead of starting a new event
  const found = (await store.findEventByHostPhone(from)) ?? (code ? await store.findEventByPendingCode(code) : null);
  if (!found) { console.log(`[events] new_request from ${from} ignored`); return "new_request"; }
  let next: string | null = null, pay = false, balance: string | null = null;
  await waitLock(found.id);
  try {
    const event = await load(found.id);
    const { outcome, approval } = applyReply(event, from, body, new Date());
    audit(event, "inbound_reply", outcome);
    if (approval?.kind === "payment" && (outcome === "approved" || outcome === "declined")) {
      // a balance approval: the event stays paid; only that one payment is affected
      if (outcome === "approved") balance = approval.summary;
      else {
        planner(event, `Host declined the balance (${approval.summary})`, "balance approval");
        const vendor = await store.getVendor(approval.summary.split(":")[0]);
        if (vendor) await sendText(event, channel, event.hostPhone, balanceDeclinedText(vendor));
      }
    }
    else if (outcome === "approved") {
      if (event.status === "awaiting_approval") { setStatus(event, "approved"); pay = true; }
      else audit(event, "approval_ignored_status", event.status);
    }
    else if (outcome === "declined") { await sendText(event, channel, event.hostPhone, declinedText()); setStatus(event, "needs_planner"); }
    else if (outcome === "expired") { await sendText(event, channel, event.hostPhone, expiredText()); next = "approval expired"; }
    else if (outcome === "no_code") next = "host said: " + fence("host_message", body);
    await store.saveEvent(event);
    return outcome;
  } finally {
    unlock(found.id);
    // follow-up work is detached so the webhook answers within the locked part (the poller would time out and replay)
    if (pay) void paymentJob(found.id).catch(console.error);
    if (balance) void balanceJob(found.id, balance).catch(console.error);
    if (next) void startLeadRun(found.id, next).catch(console.error);
  }
}
