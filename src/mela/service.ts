// The one interface the UI talks to. Components never know which adapter answered;
// every response that carries data also carries a DataOrigin so labels stay truthful.
import type { Actor, CallApproval, CallAttempt, CallOutcome, CallPlan, EventBrief, FinanceCase, IntakeResult, ManagerDecision, ResearchSnapshot, Vendor, VoiceStatus } from "./contracts";

export type Capability = "intake" | "research" | "calls" | "finance" | "voice";

export interface MelaService {
  /** Which capabilities hit a real backend. Everything else is the labeled demo adapter. */
  live: Record<Capability, boolean>;

  intake(input: { text: string; brief: EventBrief | null; answering?: IntakeResult["questions"][number] | null }): Promise<IntakeResult>;

  /** Refuses an unconfirmed brief. */
  startResearch(brief: EventBrief): Promise<ResearchSnapshot>;
  getResearch(job: ResearchSnapshot["job"], brief: EventBrief): Promise<ResearchSnapshot>;
  cancelResearch(jobId: string): Promise<void>;

  prepareCall(brief: EventBrief, vendor: Vendor): Promise<CallPlan>;
  /** Host approval for one exact plan version. */
  approveCall(plan: CallPlan, approvedBy: string): Promise<CallApproval>;
  /** Must re-check the gate; refuses missing, stale or used approvals. */
  startCall(plan: CallPlan, approval: CallApproval): Promise<{ attempt: CallAttempt; approval: CallApproval }>;
  getCall(attempt: CallAttempt, plan: CallPlan): Promise<{ attempt: CallAttempt; outcome: CallOutcome | null }>;

  openFinanceCase(input: { brief: EventBrief; venue: Vendor; snapshot: ResearchSnapshot }): Promise<FinanceCase>;
  decideFinance(fc: FinanceCase, input: { decision: ManagerDecision["decision"]; reason: string; actor: Actor }): Promise<FinanceCase>;

  voiceStatus(): Promise<VoiceStatus>;
  transcribe(audio: Blob): Promise<{ text: string }>;
  speak(text: string): Promise<Blob>;
}

export class ServiceError extends Error {
  override name = "ServiceError";
  constructor(
    message: string,
    public readonly kind: "not_connected" | "network" | "invalid_response" | "refused" | "server",
    public readonly status?: number,
  ) {
    super(message);
  }
}
