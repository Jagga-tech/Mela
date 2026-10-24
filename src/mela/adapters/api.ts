// Live adapter: talks to the team's Next.js API routes. Each response is validated
// against src/mela/contracts.ts. Endpoints that don't exist yet surface as "not connected",
// never as a silent fallback to fixtures. Expected shapes: docs/frontend-integration.md.
import { z } from "zod";
import { CallApproval, CallAttempt, CallOutcome, CallPlan, FinanceCase, IntakeResult, ResearchSnapshot } from "../contracts";
import { requestJson } from "./http";
import { voiceClient } from "./voice";
import type { MelaService } from "../service";

export const API = {
  intake: "/api/intake",
  research: "/api/research",
  researchJob: (id: string) => `/api/research/${encodeURIComponent(id)}`,
  callPlans: "/api/calls/plans",
  callApprovals: "/api/calls/approvals",
  calls: "/api/calls",
  call: (id: string) => `/api/calls/${encodeURIComponent(id)}`,
  financeCases: "/api/finance/cases",
  financeDecision: (id: string) => `/api/finance/cases/${encodeURIComponent(id)}/decisions`,
} as const;

export function apiAdapter(): Omit<MelaService, "live"> {
  return {
    intake: ({ text, brief, answering }) => requestJson(API.intake, IntakeResult, { body: { text, brief, answering }, timeoutMs: 60_000 }),
    startResearch: (brief) => requestJson(API.research, ResearchSnapshot, { body: { brief } }),
    getResearch: (job) => requestJson(API.researchJob(job.id), ResearchSnapshot),
    cancelResearch: async (jobId) => void (await requestJson(API.researchJob(jobId), z.unknown(), { method: "DELETE" })),
    prepareCall: (brief, vendor) => requestJson(API.callPlans, CallPlan, { body: { brief, vendorId: vendor.id } }),
    approveCall: (plan, approvedBy) => requestJson(API.callApprovals, CallApproval, { body: { planId: plan.id, planVersion: plan.version, scriptHash: plan.scriptHash, approvedBy } }),
    startCall: (plan, approval) =>
      requestJson(API.calls, z.object({ attempt: CallAttempt, approval: CallApproval }), { body: { planId: plan.id, approvalId: approval.id } }),
    getCall: (attempt) => requestJson(API.call(attempt.id), z.object({ attempt: CallAttempt, outcome: CallOutcome.nullable() })),
    openFinanceCase: ({ brief, venue }) => requestJson(API.financeCases, FinanceCase, { body: { briefId: brief.id, venueId: venue.id } }),
    decideFinance: (fc, input) => requestJson(API.financeDecision(fc.id), FinanceCase, { body: input }),
    ...voiceClient,
  };
}
