// Live finance cases: the quote comes from the venue's verified, exact published prices in the live research
// job; the invoice is SIMULATED (no Hyphenate API is connected); R-02, the hold and the manager decision run
// in code (src/mela/domain/finance.ts). Integer cents throughout. No money moves, except an optional Stripe
// TEST-mode payment a human sends explicitly after release (sendTestPayment below).
import { randomInt } from "node:crypto";
import {
  STRIPE_TEST_LABEL,
  type Actor,
  type AuditEvent,
  type DataOrigin,
  type FinanceCase,
  type ManagerDecision,
  type Policy,
  type Quote,
  type QuoteLine,
  type ResearchSnapshot,
  type SourceFact,
  type StripeTestPayment,
} from "@/mela/contracts";
import { buildFinanceCase, DecisionRefused, recordManagerDecision } from "@/mela/domain/finance";
import { newId, usd } from "@/mela/domain/util";
import { StripeKeyRefused, type TestCharge } from "@/integrations/pay";
import { FinanceError } from "./http";
import type { LiveResearch } from "./research";
import type { VendorRiskGate } from "./vendorRisk";

export const LIVE_FINANCE_ORIGIN: DataOrigin = {
  mode: "live",
  provider: "bright_data+rules",
  label: "Quote from the venue's live published prices · invoice SIMULATED (no Hyphenate API) · R-02 runs in code · no money moves",
};

/** The planner business's AP policy (code config, not a venue fact): hold every line that isn't in the quote. */
export const AP_POLICY: Policy = { id: "P-1", version: 1, rule: "Hold any invoice line that is not in the approved quote.", maxAutoCents: 0, maxAutoPct: 0 };

/**
 * The simulated vendor invoice adds one line the quote doesn't have, so the R-02 hold can be shown.
 * This is a scenario parameter of the simulation, not a fact about the venue.
 */
export const SIMULATED_ADDED_LINE = { label: "Setup & breakdown fee", totalCents: 15000 } as const;

const SYSTEM: Actor = { kind: "system", id: "system", name: "System", role: "system" };

const ev = (at: Date, actor: Actor, action: string, refs: string[], detail?: string): AuditEvent => ({
  id: newId("aud"), at: at.toISOString(), actor, action, refs, detail,
});

const UNKNOWN_WHY: Record<NonNullable<SourceFact["unknownReason"]>, string> = {
  not_on_page: "isn't on its page",
  source_failed: "couldn't be read because its page failed to load",
  quote_mismatch: "couldn't be matched to the page text",
  sources_disagree: "differs between sources",
};

const shortUrl = (url?: string) => {
  if (!url) return "unknown page";
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
};

type PriceLookup =
  | { kind: "exact"; fact: SourceFact & { value: number } }
  | { kind: "estimate"; fact: SourceFact }
  | { kind: "conflicting"; values: number[] }
  | { kind: "missing"; why?: string };

function price(snapshot: ResearchSnapshot, venueId: string, field: "rental_fee" | "cleaning_fee"): PriceLookup {
  const facts = snapshot.facts.filter((f) => f.vendorId === venueId && f.field === field);
  const verified = facts.filter(
    (f): f is SourceFact & { value: number } => f.state === "verified" && typeof f.value === "number" && Number.isInteger(f.value) && f.value > 0,
  );
  const values = [...new Set(verified.map((f) => f.value))];
  if (values.length > 1 || facts.some((f) => f.state === "conflicting")) return { kind: "conflicting", values };
  const exact = verified.find((f) => f.qualifier === "exact");
  if (exact) return { kind: "exact", fact: exact };
  if (verified[0]) return { kind: "estimate", fact: verified[0] };
  const unknown = facts.find((f) => f.state === "unknown" && f.unknownReason);
  return { kind: "missing", why: unknown?.unknownReason ? UNKNOWN_WHY[unknown.unknownReason] : undefined };
}

const fourDigits = () => String(randomInt(1000, 10000));

/** Opens a finance case for one venue from the live research for its brief. Throws FinanceError on refusal. */
export function openLiveCase(research: LiveResearch, venueId: string, now: Date): FinanceCase {
  const { brief, snapshot } = research;
  const venue = snapshot.vendors.find((v) => v.id === venueId);
  if (!venue) {
    const inFlight = snapshot.job.sources.some((s) => s.vendorId === venueId);
    if (inFlight && snapshot.job.status === "running")
      throw new FinanceError(409, "This venue is still being researched. Open the finance case once its page has been read.");
    throw new FinanceError(404, "This venue isn't in the live research for this brief, so there's no published price to quote.");
  }
  if (venue.category !== "venue")
    throw new FinanceError(422, `${venue.name} is a caterer. Finance cases only cover a venue's published rental price for now.`);

  const rent = price(snapshot, venueId, "rental_fee");
  if (rent.kind === "missing")
    throw new FinanceError(422, `${venue.name} has no published price${rent.why ? ` (the rental fee ${rent.why})` : ""}, so there is no quote to check an invoice against.`);
  if (rent.kind === "conflicting")
    throw new FinanceError(409, `${venue.name}'s sources disagree on the rental fee${rent.values.length ? ` (${rent.values.map((v) => usd(v)).join(" vs ")})` : ""}, so Mela won't pick one for a quote.`);
  if (rent.kind === "estimate")
    throw new FinanceError(422, `${venue.name} only publishes an estimate${rent.fact.quote ? ` (“${rent.fact.quote}”)` : ""}, not an exact price, so there is no quote to check an invoice against.`);
  const clean = price(snapshot, venueId, "cleaning_fee");

  const used: (SourceFact & { value: number })[] = [rent.fact];
  const lines: QuoteLine[] = [{ id: "L1", label: "Venue rental", qty: 1, unitCents: rent.fact.value, totalCents: rent.fact.value }];
  if (clean.kind === "exact") {
    used.push(clean.fact);
    lines.push({ id: "L2", label: "Cleaning fee", qty: 1, unitCents: clean.fact.value, totalCents: clean.fact.value });
  }

  const n = fourDigits();
  const host = brief.hostName?.trim() || "host";
  const quote: Quote = {
    id: `Q-${n}`, vendorId: venue.id, vendorName: venue.name, lines,
    totalCents: lines.reduce((s, l) => s + l.totalCents, 0),
    approvedBy: `${host} (hand-off)`, approvedAt: now.toISOString(),
  };
  const commitmentId = `C-${n}`;
  const invoice = {
    id: `INV-${n}`, quoteId: quote.id, commitmentId, receivedAt: now.toISOString(),
    lines: [
      ...lines.map((l) => ({ id: l.id, label: l.label, totalCents: l.totalCents, quoteLineId: l.id })),
      { id: `L${lines.length + 1}`, label: SIMULATED_ADDED_LINE.label, totalCents: SIMULATED_ADDED_LINE.totalCents },
    ],
    totalCents: quote.totalCents + SIMULATED_ADDED_LINE.totalCents,
  };

  const fc = buildFinanceCase({
    eventLabel: `${brief.occasion.trim() || "Event"} · ${brief.city.trim() || "city not set"} · host: ${host}`,
    quote, commitmentId, invoice, policy: AP_POLICY, origin: LIVE_FINANCE_ORIGIN, now,
  });

  // Provenance first: where every quoted cent came from. Sorted before the agent's steps.
  const at = new Date(now.getTime() - 25_000);
  const hostActor: Actor = { kind: "human", id: "host", name: host, role: "host" };
  const provenance: AuditEvent[] = [
    ev(at, hostActor, `Handed off ${venue.name}; quote ${quote.id} built from its published prices · ${usd(quote.totalCents, { exact: true })}`,
      [quote.id, ...used.map((f) => f.id)],
      used.map((f) => `${f.field === "rental_fee" ? "Venue rental" : "Cleaning fee"} ${usd(f.value, { exact: true })}: “${f.quote ?? ""}” (${shortUrl(f.url)}${f.retrievedAt ? `, read ${f.retrievedAt}` : ""})`).join(" · ")),
  ];
  if (clean.kind === "estimate")
    provenance.push(ev(at, SYSTEM, "Cleaning fee left out of the quote: only an estimate is published", [clean.fact.id], clean.fact.quote ? `“${clean.fact.quote}”` : undefined));
  else if (clean.kind === "conflicting")
    provenance.push(ev(at, SYSTEM, "Cleaning fee left out of the quote: sources disagree", []));
  provenance.push(ev(at, SYSTEM, `Invoice ${invoice.id} is SIMULATED: the quoted lines plus an unquoted “${SIMULATED_ADDED_LINE.label}” (${usd(SIMULATED_ADDED_LINE.totalCents, { exact: true })})`, [invoice.id], "No Hyphenate API is connected"));
  return { ...fc, audit: [...provenance, ...fc.audit] };
}

/** The manager's decision. Maps the domain's refusals onto the status codes the UI shows as "refused". */
export function decide(fc: FinanceCase, input: { decision: ManagerDecision["decision"]; reason: string; actor: Actor }, now: Date): FinanceCase {
  try {
    return recordManagerDecision(fc, input, now);
  } catch (err) {
    if (!(err instanceof DecisionRefused)) throw err;
    const status = /no open exception/i.test(err.message) ? 409 : /reason/i.test(err.message) ? 422 : 403;
    throw new FinanceError(status, err.message);
  }
}

export interface TestPaymentDeps {
  secretKey: string | undefined;
  stripeCharge(secretKey: string): TestCharge;
  vendorRiskGate: VendorRiskGate;
  now(): Date;
  /** Reads the latest copy of the case and saves a new one (the store). */
  load(id: string): FinanceCase | undefined;
  save(fc: FinanceCase): void;
}

const MAX_ATTEMPTS = 2;

const withAudit = (fc: FinanceCase, ...events: AuditEvent[]): FinanceCase => ({ ...fc, audit: [...fc.audit, ...events] });

/**
 * A human's explicit "send Stripe test payment" for a draft a manager already released. Test-mode keys only;
 * idempotent (one Stripe idempotency key per case + draft + amount, reused on the one allowed retry); the vendor
 * risk gate must pass first. PaymentDraft is left exactly as the domain set it: no "paid" state is added.
 */
export async function sendTestPayment(caseId: string, actor: Actor, deps: TestPaymentDeps): Promise<FinanceCase> {
  let fc = deps.load(caseId);
  if (!fc) throw new FinanceError(404, "This finance case isn't on this server (it may have restarted). Open it again.");
  const draft = fc.paymentDraft;

  if (actor.kind !== "human" || actor.role !== "ap_manager") {
    deps.save(withAudit(fc, ev(deps.now(), SYSTEM, `Refused a Stripe test payment for ${draft.id} requested by ${actor.name}: only a human AP manager can send one`, [draft.id])));
    throw new FinanceError(403, "Only a human AP manager can send a test payment. Mela's agent can't pay.");
  }
  if (actor.id === draft.requestedBy) throw new FinanceError(403, "Separation of duties: the requester can't pay their own payment draft.");
  if (draft.status !== "released_for_manual_payment")
    throw new FinanceError(409, `${draft.id} is ${draft.status === "held" ? "still held" : "revised and unreleased"}. A manager has to release it before a test payment.`);

  const prior = fc.testPayment;
  if (prior?.status === "succeeded") return fc; // the same click twice: nothing new happens
  if (prior?.status === "pending") throw new FinanceError(409, "A Stripe test payment for this draft is already in flight.");
  if (prior && prior.attempts >= MAX_ATTEMPTS)
    throw new FinanceError(409, `The Stripe test payment already failed ${prior.attempts} times (${prior.failureReason ?? "no reason given"}). Mela won't retry again.`);

  if (!deps.secretKey) throw new FinanceError(503, "Stripe test mode isn't connected (STRIPE_SECRET_KEY is not set on the server).");
  let charge: TestCharge;
  try {
    charge = deps.stripeCharge(deps.secretKey);
  } catch (err) {
    if (err instanceof StripeKeyRefused) throw new FinanceError(403, err.message);
    throw err;
  }

  const gate = await deps.vendorRiskGate(fc.quote.vendorId).catch((err: unknown) => ({ ok: false as const, reason: `Vendor check failed: ${err instanceof Error ? err.message : String(err)}` }));
  fc = deps.load(caseId) ?? fc;
  if (!gate.ok) {
    deps.save(withAudit(fc, ev(deps.now(), SYSTEM, `Stripe test payment for ${draft.id} refused: ${gate.reason}`, [draft.id, fc.quote.vendorId])));
    throw new FinanceError(409, `No test payment: ${gate.reason.replace(/\.$/, "")}. ${fc.quote.vendorName} has to pass the vendor check first.`);
  }
  // Re-check after the await: another request may have started one meanwhile.
  if (fc.testPayment?.status === "pending" || fc.testPayment?.status === "succeeded") {
    if (fc.testPayment.status === "succeeded") return fc;
    throw new FinanceError(409, "A Stripe test payment for this draft is already in flight.");
  }

  const startedAt = deps.now();
  const pending: StripeTestPayment = {
    id: prior?.id ?? newId("tpay"),
    paymentDraftId: draft.id,
    amountCents: draft.amountCents,
    currency: "usd",
    provider: "stripe_test",
    livemode: false,
    status: "pending",
    idempotencyKey: prior?.idempotencyKey ?? `mela-test-${fc.id}-${draft.id}-${draft.amountCents}`,
    attempts: (prior?.attempts ?? 0) + 1,
    requestedBy: actor,
    requestedAt: startedAt.toISOString(),
    label: STRIPE_TEST_LABEL,
  };
  deps.save({
    ...withAudit(fc, ev(startedAt, actor, `Sent a Stripe test payment of ${usd(draft.amountCents, { exact: true })} for ${draft.id}${pending.attempts > 1 ? ` (retry ${pending.attempts} of ${MAX_ATTEMPTS})` : ""}`, [draft.id, pending.id], STRIPE_TEST_LABEL)),
    testPayment: pending,
  });

  const result = await charge({
    amountCents: draft.amountCents,
    idempotencyKey: pending.idempotencyKey,
    description: `Mela test payment ${draft.id} · ${STRIPE_TEST_LABEL}`,
    metadata: { caseId: fc.id, paymentDraftId: draft.id, vendorId: fc.quote.vendorId, mela: "test_mode" },
  }).catch((err: unknown) => ({ ok: false as const, outcome: "unknown" as const, message: err instanceof Error ? err.message : String(err) }));

  const doneAt = deps.now();
  const latest = deps.load(caseId) ?? fc;
  const settled: StripeTestPayment = result.ok
    ? { ...pending, status: "succeeded", stripePaymentIntentId: result.paymentIntentId, completedAt: doneAt.toISOString() }
    : { ...pending, status: result.outcome, failureReason: result.message, completedAt: doneAt.toISOString() };
  const next: FinanceCase = {
    ...withAudit(latest, result.ok
      ? ev(doneAt, SYSTEM, `Stripe test payment ${result.paymentIntentId} succeeded · ${usd(draft.amountCents, { exact: true })} · no real money moved`, [draft.id, pending.id, result.paymentIntentId], STRIPE_TEST_LABEL)
      : ev(doneAt, SYSTEM, `Stripe test payment ${result.outcome === "unknown" ? "result unknown" : "failed"}: ${result.message}`, [draft.id, pending.id], STRIPE_TEST_LABEL)),
    testPayment: settled,
  };
  deps.save(next);
  if (!result.ok)
    throw new FinanceError(502, `Stripe test payment ${result.outcome === "unknown" ? "result is unknown" : "failed"}: ${result.message}`, { financeCase: next });
  return next;
}

