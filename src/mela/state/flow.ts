// Pure flow state. No I/O here: the provider calls the service and dispatches results.
import type { AuditEvent, CallApproval, CallAttempt, CallOutcome, CallPlan, ClarifyingQuestion, DataOrigin, EventBrief, FinanceCase, ResearchSnapshot, VendorCategory } from "../contracts";
import { newId } from "../domain/util";

export type Step = "welcome" | "shape" | "discover" | "decide" | "contact" | "handoff" | "ops" | "summary";

export type ChatMessage = { id: string; from: "mela" | "host"; text: string; at: string; origin?: DataOrigin };

export type FlowState = {
  step: Step;
  brief: EventBrief | null;
  questions: ClarifyingQuestion[];
  messages: ChatMessage[];
  intakeOrigin: DataOrigin | null;
  research: ResearchSnapshot | null;
  selected: Record<VendorCategory, string | null>;
  callPlan: CallPlan | null;
  approval: CallApproval | null;
  attempt: CallAttempt | null;
  outcome: CallOutcome | null;
  financeCase: FinanceCase | null;
  /** What Mela actually did for the host, shown on the summary. */
  actions: AuditEvent[];
};

export const initialState: FlowState = {
  step: "welcome", brief: null, questions: [], messages: [], intakeOrigin: null, research: null,
  selected: { venue: null, catering: null }, callPlan: null, approval: null, attempt: null, outcome: null, financeCase: null, actions: [],
};

export type FlowAction =
  | { type: "go"; step: Step }
  | { type: "host_said"; text: string }
  | { type: "mela_said"; text: string; origin?: DataOrigin }
  | { type: "intake"; brief: EventBrief; questions: ClarifyingQuestion[]; origin: DataOrigin }
  | { type: "brief"; brief: EventBrief }
  | { type: "research"; snapshot: ResearchSnapshot }
  | { type: "select"; category: VendorCategory; vendorId: string | null }
  | { type: "call_plan"; plan: CallPlan | null }
  | { type: "approval"; approval: CallApproval | null }
  | { type: "attempt"; attempt: CallAttempt; outcome: CallOutcome | null }
  | { type: "finance"; financeCase: FinanceCase }
  | { type: "did"; action: string; detail?: string; origin?: DataOrigin }
  | { type: "hydrate"; state: FlowState }
  | { type: "reset" };

const msg = (from: ChatMessage["from"], text: string, origin?: DataOrigin): ChatMessage => ({ id: newId("m"), from, text, at: new Date().toISOString(), origin });

export function reduce(s: FlowState, a: FlowAction): FlowState {
  switch (a.type) {
    case "go":
      return { ...s, step: a.step };
    case "host_said":
      return { ...s, messages: [...s.messages, msg("host", a.text)] };
    case "mela_said":
      return { ...s, messages: [...s.messages, msg("mela", a.text, a.origin)] };
    case "intake":
      return { ...s, brief: a.brief, questions: a.questions, intakeOrigin: a.origin };
    case "brief": {
      // an edited brief keeps its research, but the UI flags it stale via job.briefVersion
      return { ...s, brief: a.brief };
    }
    case "research":
      return { ...s, research: a.snapshot };
    case "select": {
      const changed = s.selected[a.category] !== a.vendorId;
      // changing the venue drops any plan/approval for the old one. Selecting never starts a call.
      const dropCall = changed && a.category === "venue" && !s.attempt;
      return {
        ...s,
        selected: { ...s.selected, [a.category]: a.vendorId },
        ...(dropCall ? { callPlan: null, approval: null } : {}),
      };
    }
    case "call_plan":
      return { ...s, callPlan: a.plan };
    case "approval":
      return { ...s, approval: a.approval };
    case "attempt":
      return { ...s, attempt: a.attempt, outcome: a.outcome };
    case "finance":
      return { ...s, financeCase: a.financeCase };
    case "did":
      return {
        ...s,
        actions: [...s.actions, { id: newId("act"), at: new Date().toISOString(), actor: { kind: "agent", id: "mela", name: "Mela" }, action: a.action, detail: a.detail ?? a.origin?.label, refs: [] }],
      };
    case "hydrate":
      return a.state;
    case "reset":
      return initialState;
  }
}

/** Which steps the host can jump to from the app bar. */
export function reachable(s: FlowState): Record<Step, boolean> {
  const confirmed = !!s.brief?.confirmedAt;
  return {
    welcome: true,
    shape: !!s.brief,
    discover: confirmed && !!s.research,
    decide: !!s.research && s.research.job.status !== "running",
    contact: !!s.selected.venue,
    handoff: !!s.attempt || !!s.callPlan,
    ops: !!s.financeCase,
    summary: !!s.brief,
  };
}

export const researchIsStale = (s: FlowState) => !!s.research && !!s.brief && s.research.job.briefVersion !== s.brief.version;
