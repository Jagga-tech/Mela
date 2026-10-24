"use client";
// Connects the pure flow reducer to the service. Screens call these actions; they never fetch.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type { CallPlan, EventBrief, ManagerDecision, Vendor, VendorCategory } from "../contracts";
import { createService } from "../adapters";
import { confirmBrief as confirmBriefRule, editBrief as editBriefRule } from "../domain/intake";
import { editCallPlan as editCallPlanRule } from "../domain/calls";
import { ServiceError, type MelaService } from "../service";
import { initialState, reduce, type Step } from "./flow";
import * as fx from "../fixtures/oakland-baby-shower";

const STORAGE_KEY = "mela:flow:v1";

export type UiError = { message: string; kind: ServiceError["kind"] | "unknown"; retry?: () => void };

type Ctx = ReturnType<typeof useMelaController>;
const MelaContext = createContext<Ctx | null>(null);

export function useMela(): Ctx {
  const c = useContext(MelaContext);
  if (!c) throw new Error("useMela outside MelaProvider");
  return c;
}

function toUiError(e: unknown, retry?: () => void): UiError {
  if (e instanceof ServiceError) return { message: e.message, kind: e.kind, retry };
  return { message: (e as Error)?.message || "Something went wrong.", kind: "unknown", retry };
}

function useMelaController(service: MelaService) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // sessionStorage keeps an edited brief across reloads; it is a convenience, the app works without it
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) dispatch({ type: "hydrate", state: { ...initialState, ...JSON.parse(raw) } });
    } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, [state, hydrated]);

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>, retry?: () => void): Promise<T | undefined> => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(toUiError(e, retry));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);

  const go = useCallback((step: Step) => dispatch({ type: "go", step }), []);

  const say = useCallback(async (text: string) => {
    const s = stateRef.current;
    const answering = s.questions[0] ?? null;
    dispatch({ type: "host_said", text });
    if (s.step === "welcome") dispatch({ type: "go", step: "shape" });
    const r = await run("intake", () => service.intake({ text, brief: s.brief, answering }), () => void say(text));
    if (!r) return;
    dispatch({ type: "intake", brief: r.brief, questions: r.questions, origin: r.origin });
    if (!s.brief) dispatch({ type: "did", action: "Read your description into an editable brief", origin: r.origin });
    const heard = r.changes.length ? `Got it — ${r.changes.slice(0, 4).join(" · ")}${r.changes.length > 4 ? ` · +${r.changes.length - 4} more` : ""}.` : "I didn't catch anything new in that — could you say it another way?";
    dispatch({ type: "mela_said", text: r.questions[0] ? `${heard} ${r.questions[0].question}` : `${heard} Check the brief, set what's a must-have, and tell me when to start researching.`, origin: r.origin });
  }, [run, service]);

  const editBrief = useCallback((patch: Partial<EventBrief>) => {
    const b = stateRef.current.brief;
    if (b) dispatch({ type: "brief", brief: editBriefRule(b, patch) });
  }, []);
  const setBrief = useCallback((brief: EventBrief) => dispatch({ type: "brief", brief }), []);

  const startResearch = useCallback(async () => {
    const b = stateRef.current.brief;
    if (!b) return;
    let confirmed: EventBrief;
    try {
      confirmed = b.confirmedAt ? b : confirmBriefRule(b);
    } catch (e) {
      setError(toUiError(e));
      return;
    }
    dispatch({ type: "brief", brief: confirmed });
    const snap = await run("research", () => service.startResearch(confirmed), () => void startResearch());
    if (!snap) return;
    dispatch({ type: "research", snapshot: snap });
    dispatch({ type: "did", action: "Researched venues and caterers for your confirmed brief", origin: snap.job.origin });
    dispatch({ type: "go", step: "discover" });
  }, [run, service]);

  // poll research while it runs
  const job = state.research?.job;
  useEffect(() => {
    if (!job || job.status !== "running" || !state.brief) return;
    const t = setTimeout(async () => {
      try {
        const snap = await service.getResearch(job, stateRef.current.brief!);
        dispatch({ type: "research", snapshot: snap });
      } catch (e) {
        setError(toUiError(e));
      }
    }, 450);
    return () => clearTimeout(t);
  }, [job, service, state.brief]);

  const cancelResearch = useCallback(async () => {
    const j = stateRef.current.research?.job;
    if (!j) return;
    await run("research", () => service.cancelResearch(j.id));
    const snap = await run("research", () => service.getResearch(j, stateRef.current.brief!));
    if (snap) dispatch({ type: "research", snapshot: snap });
  }, [run, service]);

  const select = useCallback((category: VendorCategory, vendorId: string | null) => dispatch({ type: "select", category, vendorId }), []);

  const vendorById = useCallback((id: string | null): Vendor | undefined => stateRef.current.research?.vendors.find((v) => v.id === id), []);

  const prepareCall = useCallback(async () => {
    const s = stateRef.current;
    const vendor = vendorById(s.selected.venue);
    if (!s.brief || !vendor) return;
    const plan = await run("call_plan", () => service.prepareCall(s.brief!, vendor), () => void prepareCall());
    if (!plan) return;
    dispatch({ type: "call_plan", plan });
    dispatch({ type: "approval", approval: null });
    dispatch({ type: "did", action: `Prepared a call plan for ${vendor.name} (not sent)` });
    dispatch({ type: "go", step: "contact" });
  }, [run, service, vendorById]);

  const editCallPlan = useCallback((patch: Partial<Pick<CallPlan, "questions" | "opening">>) => {
    const p = stateRef.current.callPlan;
    if (!p) return;
    dispatch({ type: "call_plan", plan: editCallPlanRule(p, patch) });
    // the old approval no longer matches; drop it so the host re-approves the new version
    if (stateRef.current.approval) dispatch({ type: "approval", approval: null });
  }, []);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCall = useCallback(() => {
    const tick = async () => {
      const s = stateRef.current;
      if (!s.attempt || !s.callPlan) return;
      try {
        const r = await service.getCall(s.attempt, s.callPlan);
        dispatch({ type: "attempt", attempt: r.attempt, outcome: r.outcome });
        if (["completed", "declined", "failed", "not_contacted"].includes(r.attempt.state)) {
          dispatch({ type: "did", action: r.attempt.mode === "simulated" ? "Ran a simulated call (no phone dialed)" : `Called ${s.callPlan.vendorName} once, with your approval`, detail: `Result: ${r.attempt.state}` });
          return;
        }
      } catch (e) {
        setError(toUiError(e, () => pollCall()));
        return;
      }
      pollRef.current = setTimeout(tick, 500);
    };
    // first tick waits a beat so the dispatched attempt has reached stateRef
    pollRef.current = setTimeout(tick, 300);
  }, [service]);
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  // resume polling after a reload mid-call
  useEffect(() => {
    if (hydrated && stateRef.current.attempt && ["dialing", "connected", "approved", "preparing"].includes(stateRef.current.attempt.state)) pollCall();
  }, [hydrated, pollCall]);

  const approveAndCall = useCallback(async (approvedBy: string) => {
    const s = stateRef.current;
    if (!s.callPlan) return;
    const approval = await run("approve", () => service.approveCall(s.callPlan!, approvedBy));
    if (!approval) return;
    dispatch({ type: "approval", approval });
    dispatch({ type: "did", action: `You approved one call to ${s.callPlan.vendorName} (plan v${s.callPlan.version})` });
    const started = await run("call", () => service.startCall(s.callPlan!, approval));
    if (!started) return;
    dispatch({ type: "approval", approval: started.approval });
    dispatch({ type: "attempt", attempt: started.attempt, outcome: null });
    pollCall();
  }, [run, service, pollCall]);

  const openFinance = useCallback(async () => {
    const s = stateRef.current;
    const venue = vendorById(s.selected.venue);
    if (!s.brief || !venue || !s.research) return;
    const fc = await run("finance", () => service.openFinanceCase({ brief: s.brief!, venue, snapshot: s.research! }), () => void openFinance());
    if (!fc) return;
    dispatch({ type: "finance", financeCase: fc });
    dispatch({ type: "go", step: "ops" });
  }, [run, service, vendorById]);

  const decide = useCallback(async (decision: ManagerDecision["decision"], reason: string) => {
    const fc = stateRef.current.financeCase;
    if (!fc) return false;
    const next = await run("decide", () => service.decideFinance(fc, { decision, reason, actor: fx.scenario.manager }));
    if (next) dispatch({ type: "finance", financeCase: next });
    return !!next;
  }, [run, service]);

  const reset = useCallback(() => {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
    dispatch({ type: "reset" });
  }, []);

  return useMemo(() => ({
    state, dispatch, busy, error, clearError: () => setError(null), hydrated, service,
    go, say, editBrief, setBrief, startResearch, cancelResearch, select, vendorById, prepareCall, editCallPlan, approveAndCall, openFinance, decide, reset,
  }), [state, busy, error, hydrated, service, go, say, editBrief, setBrief, startResearch, cancelResearch, select, vendorById, prepareCall, editCallPlan, approveAndCall, openFinance, decide, reset]);
}

export function MelaProvider({ children, service }: { children: ReactNode; service?: MelaService }) {
  const svc = useMemo(() => service ?? createService(), [service]);
  const ctl = useMelaController(svc);
  return <MelaContext.Provider value={ctl}>{children}</MelaContext.Provider>;
}
