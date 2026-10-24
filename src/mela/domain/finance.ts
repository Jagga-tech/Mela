// Mela Events AP workflow (built for the Hyphenate track; no Hyphenate API is called).
// Rule R-02: every invoice line must map to an approved quote line with the same total.
// Integer cents only. The agent can hold and explain; only a human AP manager can decide.
import type { Actor, AuditEvent, DataOrigin, FinanceCase, Invoice, LineResult, ManagerDecision, Policy, Quote } from "../contracts";
import { newId, usd } from "./util";

export const MELA_AP_AGENT: Actor = { kind: "agent", id: "agent_mela_ap", name: "Mela (agent)", role: "ap_agent" };
const SYSTEM: Actor = { kind: "system", id: "system", name: "System", role: "system" };

export function evaluateInvoice(quote: Quote, invoice: Invoice, policy: Policy) {
  const lineResults: LineResult[] = [];
  const used = new Set<string>();
  for (const line of invoice.lines) {
    const q = line.quoteLineId ? quote.lines.find((l) => l.id === line.quoteLineId) : undefined;
    if (!q) {
      lineResults.push({ invoiceLineId: line.id, quoteLineId: null, label: line.label, quoteCents: null, invoiceCents: line.totalCents, diffCents: line.totalCents, result: "not_in_quote" });
      continue;
    }
    used.add(q.id);
    const diff = line.totalCents - q.totalCents;
    lineResults.push({ invoiceLineId: line.id, quoteLineId: q.id, label: q.label, quoteCents: q.totalCents, invoiceCents: line.totalCents, diffCents: diff, result: diff === 0 ? "match" : "amount_differs" });
  }
  for (const q of quote.lines.filter((l) => !used.has(l.id)))
    lineResults.push({ invoiceLineId: null, quoteLineId: q.id, label: q.label, quoteCents: q.totalCents, invoiceCents: null, diffCents: -q.totalCents, result: "missing_on_invoice" });

  const failing = lineResults.filter((r) => r.result === "not_in_quote" || r.result === "amount_differs");
  const failingLineIds = failing.map((r) => r.invoiceLineId!);
  const deltaCents = failing.reduce((s, r) => s + r.diffCents, 0);
  const invoiceSum = invoice.lines.reduce((s, l) => s + l.totalCents, 0);
  const totalsAgree = invoiceSum === invoice.totalCents;

  let outcome: FinanceCase["outcome"];
  if (!failing.length && totalsAgree) outcome = "matched";
  else if (totalsAgree && policy.maxAutoCents > 0 && deltaCents > 0 && deltaCents <= policy.maxAutoCents && deltaCents * 100 <= policy.maxAutoPct * quote.totalCents)
    outcome = "auto_approved_with_notice";
  else outcome = "held";
  return { lineResults, failingLineIds, deltaCents, outcome, totalsAgree };
}

const ev = (at: Date, actor: Actor, action: string, refs: string[], detail?: string): AuditEvent => ({ id: newId("aud"), at: at.toISOString(), actor, action, refs, detail });

export function buildFinanceCase(args: { eventLabel: string; quote: Quote; commitmentId: string; invoice: Invoice; policy: Policy; origin: DataOrigin; now?: Date }): FinanceCase {
  const { quote, invoice, policy } = args;
  const now = args.now ?? new Date();
  const r = evaluateInvoice(quote, invoice, policy);
  const draftId = "PAY-" + invoice.id.replace(/\D/g, "").slice(-4).padStart(4, "0");
  const t = (s: number) => new Date(now.getTime() + s * 1000);
  const audit: AuditEvent[] = [
    ev(t(0), SYSTEM, `Invoice ${invoice.id} received · ${usd(invoice.totalCents, { exact: true })}`, [invoice.id], "Simulated AP inbox"),
    ev(t(6), MELA_AP_AGENT, `Matched ${invoice.id} to commitment ${args.commitmentId} / quote ${quote.id}`, [args.commitmentId, quote.id],
      `${r.lineResults.filter((l) => l.result === "match").length} of ${invoice.lines.length} lines match`),
  ];
  const exceptionId = "EX-" + invoice.id.replace(/\D/g, "").slice(-2);
  if (r.outcome === "held") {
    audit.push(ev(t(14), MELA_AP_AGENT, `Rule R-02 failed on ${r.failingLineIds.join(", ")} (${usd(r.deltaCents, { exact: true })}) → held payment draft ${draftId}`, [exceptionId, draftId]));
    audit.push(ev(t(17), MELA_AP_AGENT, `Escalated ${exceptionId} to an AP manager · Mela has no approve permission`, [exceptionId], "role: ap_agent"));
  } else if (r.outcome === "auto_approved_with_notice") {
    audit.push(ev(t(14), MELA_AP_AGENT, `Policy ${policy.id} v${policy.version}: ${usd(r.deltaCents, { exact: true })} under the auto limit · host notified`, [draftId]));
  }
  return {
    id: newId("case"),
    eventLabel: args.eventLabel,
    quote,
    commitmentId: args.commitmentId,
    invoice,
    policy,
    lineResults: r.lineResults,
    outcome: r.outcome,
    exception: r.outcome === "matched" ? null : {
      id: exceptionId, invoiceId: invoice.id, rule: "R-02", failingLineIds: r.failingLineIds, deltaCents: r.deltaCents,
      status: r.outcome === "held" ? "held" : "auto_approved_with_notice", paymentDraftId: draftId,
    },
    paymentDraft: { id: draftId, amountCents: invoice.totalCents, status: r.outcome === "held" ? "held" : "released_for_manual_payment", requestedBy: MELA_AP_AGENT.id, simulated: true },
    decisions: [],
    audit,
    origin: args.origin,
  };
}

export class DecisionRefused extends Error {
  override name = "DecisionRefused";
}

/** The only way a held exception changes state. Refuses agents, the requester, missing reasons and closed cases. */
export function recordManagerDecision(fc: FinanceCase, input: { decision: ManagerDecision["decision"]; reason: string; actor: Actor }, now = new Date()): FinanceCase {
  const { actor } = input;
  if (actor.kind !== "human" || actor.role !== "ap_manager") throw new DecisionRefused("Only a human AP manager can decide on a held exception.");
  if (actor.id === fc.paymentDraft.requestedBy) throw new DecisionRefused("Separation of duties: the requester cannot approve their own payment.");
  if (!fc.exception || (fc.exception.status !== "held" && fc.exception.status !== "waiting_vendor")) throw new DecisionRefused("There is no open exception to decide.");
  const reason = input.reason.trim();
  if (reason.length < 3) throw new DecisionRefused("A decision needs a written reason.");

  const next: FinanceCase = structuredClone(fc);
  const ex = next.exception!;
  const decision: ManagerDecision = { id: newId("dec"), exceptionId: ex.id, decision: input.decision, reason, actor, at: now.toISOString() };
  next.decisions.push(decision);
  const lines = ex.failingLineIds.join(", ");
  next.audit.push(ev(now, actor, `${input.decision === "approve_line" ? "Approved" : input.decision === "reject_line" ? "Rejected" : "Asked the vendor about"} ${lines}: “${reason}”`, [ex.id, decision.id]));

  const later = new Date(now.getTime() + 1000);
  if (input.decision === "reject_line") {
    ex.status = "resolved_rejected";
    next.paymentDraft = { ...next.paymentDraft, amountCents: next.invoice.totalCents - ex.deltaCents, status: "revised_unreleased" };
    next.audit.push(ev(later, SYSTEM, `${next.paymentDraft.id} revised to ${usd(next.paymentDraft.amountCents, { exact: true })} · still unreleased · corrected invoice requested`, [next.paymentDraft.id]));
  } else if (input.decision === "approve_line") {
    ex.status = "resolved_approved";
    next.paymentDraft = { ...next.paymentDraft, status: "released_for_manual_payment" };
    next.audit.push(ev(later, SYSTEM, `${next.paymentDraft.id} released for manual payment outside Mela · no money moved`, [next.paymentDraft.id]));
  } else {
    ex.status = "waiting_vendor";
    next.audit.push(ev(later, SYSTEM, `${next.paymentDraft.id} stays held while the vendor explains`, [next.paymentDraft.id]));
  }
  return next;
}
