// Call plans and the approval gate. An approval binds one exact plan version, script hash,
// number, vendor and disclosure set, for a single attempt. Anything that drifts makes it stale.
import type { CallApproval, CallOutcome, CallPlan, EventBrief, PriceEvidence, Vendor } from "../contracts";
import { formatDate, newId, stableHash } from "./util";

export const APPROVAL_TTL_MS = 15 * 60 * 1000;

export const DISCLOSURE =
  "Hi, this is Mela, an AI assistant calling on behalf of a host who is planning an event. I can't book anything or agree to payments. Do you have two minutes for a few questions?";

const MUST_NOT_AGREE = ["Any booking, hold or reservation", "Any deposit, payment or card details", "Sharing the host's budget or phone number"];

const hashPlan = (p: Omit<CallPlan, "scriptHash">) =>
  stableHash({ v: p.version, vendorId: p.vendorId, phone: p.phoneNumber, disclosure: p.disclosure, opening: p.opening, questions: p.questions, shared: p.sharedDetails, mustNot: p.mustNotAgreeTo });

export function defaultQuestions(brief: EventBrief, vendor: Vendor): string[] {
  const guests = brief.guestRange ? (brief.guestRange.min === brief.guestRange.max ? `${brief.guestRange.max}` : `${brief.guestRange.min} to ${brief.guestRange.max}`) : "our";
  const q = [`Is ${brief.dateTarget ? formatDate(brief.dateTarget) : "our date"} open for a ${brief.occasion || "private event"} of ${guests} guests?`];
  if (vendor.category === "venue") {
    const keys = new Set(brief.requirements.filter((r) => r.priority === "MUST_HAVE").map((r) => r.key));
    if (keys.has("outside_catering")) q.push("Can we bring our own outside caterer?");
    if (keys.has("alcohol_allowed")) q.push("Is alcohol allowed, and do you require a licensed bartender or event insurance?");
    q.push("What is the rental fee for about five hours, and are there cleaning, setup or other fees?");
    q.push("What deposit do you require, and when is it due?");
  } else {
    q.push("Do you offer both meat and vegetarian dishes, and what is the price per guest?");
    q.push("Is delivery and setup included, and what deposit do you require?");
  }
  return q;
}

export function buildCallPlan(args: { brief: EventBrief; vendor: Vendor; phoneNumber: string; numberSource: CallPlan["numberSource"]; rolePlay: boolean; now?: Date }): CallPlan {
  const { brief, vendor } = args;
  if (!brief.confirmedAt) throw new Error("Confirm the brief before preparing a call");
  const shared: CallPlan["sharedDetails"] = [
    { key: "occasion", label: "Occasion", value: brief.occasion },
    { key: "city", label: "City", value: brief.city },
    { key: "date", label: "Date", value: formatDate(brief.dateTarget) },
    { key: "guests", label: "Guest count", value: brief.guestRange ? `${brief.guestRange.min}–${brief.guestRange.max}` : "Not set" },
  ];
  if (brief.hostName) shared.push({ key: "host_first_name", label: "Your first name", value: brief.hostName });
  const base = {
    id: newId("plan"),
    version: 1,
    briefId: brief.id,
    vendorId: vendor.id,
    vendorName: vendor.name,
    phoneNumber: args.phoneNumber,
    numberSource: args.numberSource,
    rolePlay: args.rolePlay,
    disclosure: DISCLOSURE,
    opening: `I'm asking for a ${brief.occasion || "private event"} in ${brief.city}.`,
    questions: defaultQuestions(brief, vendor),
    sharedDetails: shared,
    privateDetails: ["Your budget", "Your phone number and email", "Anything you haven't approved here"],
    mustNotAgreeTo: MUST_NOT_AGREE,
    createdAt: (args.now ?? new Date()).toISOString(),
  };
  return { ...base, scriptHash: hashPlan(base) };
}

/** Any edit produces a new version and hash, which invalidates earlier approvals. */
export function editCallPlan(plan: CallPlan, patch: Partial<Pick<CallPlan, "questions" | "sharedDetails" | "opening">>): CallPlan {
  const { scriptHash: _old, ...rest } = plan; // eslint-disable-line @typescript-eslint/no-unused-vars
  const next = { ...rest, ...patch, version: plan.version + 1 };
  return { ...next, scriptHash: hashPlan(next) };
}

export function approveCallPlan(plan: CallPlan, approvedBy: string, now = new Date()): CallApproval {
  if (hashPlan(plan) !== plan.scriptHash) throw new Error("Call plan hash does not match its contents");
  return {
    id: newId("appr"),
    callPlanId: plan.id,
    callPlanVersion: plan.version,
    scriptHash: plan.scriptHash,
    vendorId: plan.vendorId,
    phoneNumber: plan.phoneNumber,
    disclosedKeys: plan.sharedDetails.map((d) => d.key),
    approvedBy,
    approvedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
    maxAttempts: 1,
    attemptsUsed: 0,
    status: "active",
  };
}

export type GateRefusal = "no_approval" | "revoked" | "already_used" | "expired" | "wrong_plan" | "stale_version" | "script_changed" | "number_changed" | "vendor_changed" | "disclosure_changed";

export const gateMessage: Record<GateRefusal, string> = {
  no_approval: "No approval for this call yet.",
  revoked: "You cancelled this approval.",
  already_used: "This approval was already used for one attempt.",
  expired: "This approval expired. Review the plan and approve again.",
  wrong_plan: "This approval is for a different call plan.",
  stale_version: "The plan changed after you approved it. Approve the new version.",
  script_changed: "The script changed after you approved it.",
  number_changed: "The phone number changed after you approved it.",
  vendor_changed: "The vendor changed after you approved it.",
  disclosure_changed: "The details being shared changed after you approved it.",
};

/** The single check every call path must pass, client and server. */
export function checkCallGate(approval: CallApproval | null, plan: CallPlan, now = new Date()): { ok: true } | { ok: false; reason: GateRefusal } {
  if (!approval) return { ok: false, reason: "no_approval" };
  if (approval.status === "revoked") return { ok: false, reason: "revoked" };
  if (approval.status === "consumed" || approval.attemptsUsed >= approval.maxAttempts) return { ok: false, reason: "already_used" };
  if (approval.status === "expired" || now > new Date(approval.expiresAt)) return { ok: false, reason: "expired" };
  if (approval.callPlanId !== plan.id) return { ok: false, reason: "wrong_plan" };
  if (approval.callPlanVersion !== plan.version) return { ok: false, reason: "stale_version" };
  if (approval.scriptHash !== plan.scriptHash || hashPlan(plan) !== plan.scriptHash) return { ok: false, reason: "script_changed" };
  if (approval.phoneNumber !== plan.phoneNumber) return { ok: false, reason: "number_changed" };
  if (approval.vendorId !== plan.vendorId) return { ok: false, reason: "vendor_changed" };
  if (JSON.stringify(approval.disclosedKeys) !== JSON.stringify(plan.sharedDetails.map((d) => d.key))) return { ok: false, reason: "disclosure_changed" };
  return { ok: true };
}

export function consumeApproval(approval: CallApproval): CallApproval {
  return { ...approval, attemptsUsed: approval.attemptsUsed + 1, status: "consumed" };
}

/** Turn answers into an outcome. A call never yields a written quote or a booking. */
export function buildOutcome(attemptId: string, plan: CallPlan, answers: (string | null)[], verbalPriceCents: number | null, now = new Date()): CallOutcome {
  const rows = plan.questions.map((question, i) => ({ question, answer: answers[i] ?? null, status: (answers[i] ? "vendor_said_verbally" : "not_answered") as "vendor_said_verbally" | "not_answered" }));
  const dateAnswer = rows[0]?.answer ?? "";
  const price: PriceEvidence | null = verbalPriceCents === null ? null : {
    priceType: "verbal", amountCents: verbalPriceCents, unit: "flat", unitCents: verbalPriceCents, factIds: [],
    note: "Said on the call — not a written quote",
  };
  return {
    attemptId,
    answers: rows,
    availability: /\b(yes|open|available|free)\b/i.test(dateAnswer) && !/\bnot\b/i.test(dateAnswer) ? "vendor_said_verbally" : "needs_confirmation",
    price,
    followUps: [
      "Ask for the quote and terms in writing",
      ...rows.filter((r) => r.status === "not_answered").map((r) => `Still unanswered: ${r.question}`),
    ],
    recordedAt: now.toISOString(),
  };
}
