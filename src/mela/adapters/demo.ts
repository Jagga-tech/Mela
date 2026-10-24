// Demo adapter: recorded fixtures replayed honestly. Every payload says mode "demo".
// Research "progress" is a replay of a recorded run on a fixed timeline, labeled as such.
// Calls are simulated: no phone is dialed. Finance is a simulated AP record.
import type { CallAttempt, CallPlan, DataOrigin, EventBrief, FinanceCase, IntakeResult, Quote, ResearchSnapshot, ResearchSource } from "../contracts";
import { answerQuestion, applyParsed, emptyBrief, parseIntakeText, questionsFor } from "../domain/intake";
import { approveCallPlan, buildCallPlan, buildOutcome, checkCallGate, consumeApproval, gateMessage } from "../domain/calls";
import { buildFinanceCase, recordManagerDecision } from "../domain/finance";
import { newId } from "../domain/util";
import * as fx from "../fixtures/oakland-baby-shower";
import { ServiceError, type MelaService } from "../service";
import { voiceClient } from "./voice";

const ORIGIN = {
  intake: { mode: "demo", provider: "rules", label: "Read by Mela's built-in rules (demo, no AI model)" },
  research: { mode: "demo", provider: "fixture", label: "Replay of a recorded research run · fictional vendors · not a live search" },
  call: { mode: "demo", provider: "fixture", label: "Simulated call · no phone was dialed" },
  finance: { mode: "demo", provider: "rules", label: "Simulated AP record · R-02 rule runs in code · no Hyphenate API" },
} satisfies Record<string, DataOrigin>;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cancelled = new Set<string>();

function sourcesAt(elapsed: number, isCancelled: boolean): ResearchSource[] {
  return fx.sourcePlan.map(({ final, settlesAt, ...s }) => {
    const done = elapsed >= settlesAt;
    if (done) return { ...s, status: final, attempt: 1, fetchedAt: final === "found" || final === "partial" || final === "empty" ? fx.RECORDED_AT : undefined, latencyMs: settlesAt };
    if (isCancelled) return { ...s, status: "error", attempt: 1, error: "Cancelled by you" };
    if (elapsed < 250) return { ...s, status: "queued", attempt: 0, error: undefined };
    const slow = elapsed > fx.SLOW_AFTER_MS;
    return { ...s, status: slow ? "slow" : s.sourceType === "directory_listing" ? "searching" : "fetching", attempt: 1, error: undefined };
  });
}

function snapshot(job: ResearchSnapshot["job"], now = Date.now()): ResearchSnapshot {
  const elapsed = now - new Date(job.startedAt).getTime();
  const isCancelled = cancelled.has(job.id) || job.status === "cancelled";
  const sources = sourcesAt(elapsed, isCancelled);
  const settled = (vendorId: string) => sources.some((s) => s.vendorId === vendorId && ["found", "partial", "blocked", "empty", "error"].includes(s.status));
  const apifyDone = sources.find((s) => s.id === "s-apify-posts")?.status === "found";
  const allDone = sources.every((s) => !["queued", "searching", "fetching", "extracting", "slow"].includes(s.status));
  const status = isCancelled ? "cancelled" : !allDone ? "running" : sources.some((s) => s.status !== "found") ? "partial" : "complete";
  return {
    job: { ...job, sources, status, finishedAt: allDone ? new Date(new Date(job.startedAt).getTime() + Math.max(...fx.sourcePlan.map((s) => s.settlesAt))).toISOString() : undefined },
    vendors: fx.vendors.filter((v) => settled(v.id)),
    facts: fx.sourceFacts.filter((f) => settled(f.vendorId) && sources.find((s) => s.vendorId === f.vendorId)?.status !== "blocked"),
    reviews: apifyDone ? fx.reviews : [],
  };
}

const CALL_TIMELINE = { connected: 1800, perAnswer: 1500 };

export function demoAdapter(): MelaService {
  return {
    live: { intake: false, research: false, calls: false, finance: false, voice: false },

    async intake({ text, brief, answering }): Promise<IntakeResult> {
      await wait(450);
      const r = brief ? answerQuestion(brief, answering ?? null, text) : applyParsed(emptyBrief(), parseIntakeText(text));
      return { brief: r.brief, changes: r.changes, questions: questionsFor(r.brief), origin: ORIGIN.intake };
    },

    async startResearch(brief: EventBrief) {
      if (!brief.confirmedAt) throw new ServiceError("Confirm your brief before Mela starts researching.", "refused");
      const job: ResearchSnapshot["job"] = { id: newId("job"), briefId: brief.id, briefVersion: brief.version, status: "running", startedAt: new Date().toISOString(), sources: [], origin: ORIGIN.research };
      return snapshot(job);
    },
    async getResearch(job) {
      await wait(60);
      return snapshot(job);
    },
    async cancelResearch(jobId) {
      cancelled.add(jobId);
    },

    async prepareCall(brief, vendor) {
      await wait(300);
      // demo calls only ever target the consenting teammate's role-play line, never the venue's listed number
      return buildCallPlan({
        brief, vendor, rolePlay: true, phoneNumber: fx.scenario.rolePlay.phone,
        numberSource: { label: fx.scenario.rolePlay.label, url: vendor.contact?.sourceUrl, retrievedAt: fx.RECORDED_AT },
      });
    },
    async approveCall(plan, approvedBy) {
      return approveCallPlan(plan, approvedBy);
    },
    async startCall(plan, approval) {
      const gate = checkCallGate(approval, plan);
      if (!gate.ok) throw new ServiceError(gateMessage[gate.reason], "refused");
      const used = consumeApproval(approval);
      const attempt: CallAttempt = { id: newId("call"), approvalId: approval.id, callPlanId: plan.id, state: "dialing", mode: "simulated", startedAt: new Date().toISOString(), transcript: [], origin: ORIGIN.call };
      return { attempt, approval: used };
    },
    async getCall(attempt: CallAttempt, plan: CallPlan) {
      await wait(60);
      const elapsed = Date.now() - new Date(attempt.startedAt).getTime();
      const script = plan.vendorId === fx.callScript.vendorId ? fx.callScript.answers : plan.questions.map(() => null);
      if (elapsed < CALL_TIMELINE.connected) return { attempt: { ...attempt, state: "dialing" }, outcome: null };
      const transcript: CallAttempt["transcript"] = [{ speaker: "mela", text: plan.disclosure }, { speaker: "vendor", text: "Sure, go ahead." }];
      const n = Math.min(plan.questions.length, Math.floor((elapsed - CALL_TIMELINE.connected) / CALL_TIMELINE.perAnswer));
      for (let i = 0; i < n; i++) {
        transcript.push({ speaker: "mela", text: plan.questions[i] });
        transcript.push({ speaker: "vendor", text: script[i] ?? "I'd have to check and get back to you." });
      }
      if (n < plan.questions.length) return { attempt: { ...attempt, state: "connected", transcript }, outcome: null };
      transcript.push({ speaker: "mela", text: "Thank you. The host will follow up in writing. Goodbye!" });
      const ended = { ...attempt, state: "completed" as const, transcript, endedAt: new Date(new Date(attempt.startedAt).getTime() + CALL_TIMELINE.connected + plan.questions.length * CALL_TIMELINE.perAnswer).toISOString() };
      return { attempt: ended, outcome: buildOutcome(attempt.id, plan, script, plan.vendorId === fx.callScript.vendorId ? fx.callScript.verbalPriceCents : null) };
    },

    async openFinanceCase({ brief, venue, snapshot: snap }): Promise<FinanceCase> {
      await wait(350);
      const fact = (field: string) => snap.facts.find((f) => f.vendorId === venue.id && f.field === field && f.state === "verified" && typeof f.value === "number");
      const rent = fact("rental_fee");
      const clean = fact("cleaning_fee");
      if (!rent) throw new ServiceError(`${venue.name} has no published price, so there is no quote to check an invoice against.`, "refused");
      const lines: Quote["lines"] = [{ id: "L1", label: "Venue rental", qty: 1, unitCents: rent.value as number, totalCents: rent.value as number }];
      if (clean) lines.push({ id: "L2", label: "Cleaning fee", qty: 1, unitCents: clean.value as number, totalCents: clean.value as number });
      const quote: Quote = { id: fx.finance.quoteId, vendorId: venue.id, vendorName: venue.name, lines, totalCents: lines.reduce((s, l) => s + l.totalCents, 0), approvedBy: brief.hostName ?? "host", approvedAt: new Date(Date.now() - 3600_000).toISOString() };
      const invoice = {
        id: fx.finance.invoiceId, quoteId: quote.id, commitmentId: fx.finance.commitmentId, receivedAt: new Date().toISOString(),
        lines: [...lines.map((l) => ({ id: l.id, label: l.label, totalCents: l.totalCents, quoteLineId: l.id })), { ...fx.finance.addedLine, id: `L${lines.length + 1}` }],
        totalCents: quote.totalCents + fx.finance.addedLine.totalCents,
      };
      return buildFinanceCase({
        eventLabel: `${fx.scenario.eventCode} · ${brief.occasion || "event"} · host: ${brief.hostName ?? "guest"}`,
        quote, commitmentId: fx.finance.commitmentId, invoice, policy: fx.finance.policy, origin: ORIGIN.finance,
      });
    },
    async decideFinance(fc, input) {
      await wait(250);
      try {
        return recordManagerDecision(fc, input);
      } catch (e) {
        throw new ServiceError((e as Error).message, "refused");
      }
    },

    ...voiceClient,
  };
}
