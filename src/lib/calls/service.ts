import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { CallAttempt as CallAttemptSchema, EventBrief, type CallApproval, type CallAttempt, type CallPlan, type DataOrigin } from "@/mela/contracts";
import { approveCallPlan, buildCallPlan, checkCallGate, consumeApproval, gateMessage } from "@/mela/domain/calls";
import { newId } from "@/mela/domain/util";
import { CartesiaApiError, createOutboundCall, getAgentCall, WebhookEvent, type AgentCall, type FetchFn } from "@/lib/calls/cartesia";
import { cartesiaCallConfig, digits, NotConnectedError, rolePlayLine, webhookSecret, type Env } from "./config";
import { openedWithDisclosure, outcomeFromTranscript, toTranscript } from "./outcome";
import { callStore, firstDelivery, saveApproval, saveAttempt, savePlan, type AttemptRecord } from "./store";
import { findResearchVendor, type FoundVendor } from "./vendors";

// Host-approved vendor calls. The order of checks matters:
//   plan:     confirmed brief → role-play line configured → vendor from live research
//   approval: server's own plan, exact version + script hash
//   call:     Cartesia configured → checkCallGate on the server's stored approval →
//             role-play number unchanged → consume the approval (before any await) → dial once
// Status codes follow docs/frontend-integration.md §4.

export class CallError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "CallError";
  }
}

export interface CallDeps {
  env?: Env;
  fetchImpl?: FetchFn;
  now?: () => Date;
  findVendor?: (vendorId: string, briefId?: string) => FoundVendor | null;
  /** ms between provider polls for one attempt; the UI polls every 500 ms. */
  pollEveryMs?: number;
  retryDelayMs?: number;
}

const env = (d: CallDeps) => d.env ?? process.env;
const now = (d: CallDeps) => (d.now ?? (() => new Date()))();

export const CALL_ORIGIN: DataOrigin = { mode: "live", provider: "cartesia", label: "Cartesia voice agent · role-play call to a consenting teammate" };
const TERMINAL = new Set<CallAttempt["state"]>(["completed", "declined", "failed", "not_contacted"]);
const MAX_DIAL_ATTEMPTS = 2;
const MAX_CALL_MINUTES = 6;
/** If Cartesia never reports an end, stop waiting after this long. */
const GIVE_UP_MS = (MAX_CALL_MINUTES + 4) * 60_000;

// ---------- POST /api/calls/plans ----------

const PlanBody = z.object({ brief: EventBrief, vendorId: z.string().min(1) });

export function createPlan(body: unknown, deps: CallDeps = {}): CallPlan {
  const p = PlanBody.safeParse(body);
  if (!p.success) throw new CallError("Send the confirmed brief and the vendor id as { brief, vendorId }.", 422);
  const { brief, vendorId } = p.data;
  if (!brief.confirmedAt) throw new CallError("Confirm your brief before Mela prepares a call.", 409);
  const line = rolePlayLine(env(deps));
  const found = (deps.findVendor ?? findResearchVendor)(vendorId, brief.id);
  if (!found) throw new CallError("That vendor isn't in a live research job on this server (it may have restarted). Run the research again.", 404);
  const listed = found.vendor.contact?.phone;
  if (listed && digits(listed) === digits(line.phone))
    throw new CallError("The role-play number is the vendor's own listed number. Demo calls only go to a teammate playing the vendor.", 409);
  const plan = buildCallPlan({ brief, vendor: found.vendor, phoneNumber: line.phone, numberSource: { label: line.label }, rolePlay: true, now: now(deps) });
  savePlan(plan);
  return plan;
}

// ---------- POST /api/calls/approvals ----------

const ApprovalBody = z.object({ planId: z.string().min(1), planVersion: z.number().int().min(1), scriptHash: z.string().min(1), approvedBy: z.string().trim().min(1).max(120) });

export function approve(body: unknown, deps: CallDeps = {}): CallApproval {
  const p = ApprovalBody.safeParse(body);
  if (!p.success) throw new CallError("Send { planId, planVersion, scriptHash, approvedBy }.", 422);
  const plan = callStore.plans.get(p.data.planId);
  if (!plan) throw new CallError("This call plan isn't on this server (it may have restarted). Prepare the call plan again.", 404);
  if (p.data.planVersion > plan.version)
    throw new CallError("This plan was edited in the browser, and live calls only use the plan the server prepared. Prepare the call plan again.", 409);
  if (p.data.planVersion !== plan.version) throw new CallError(gateMessage.stale_version, 409);
  if (p.data.scriptHash !== plan.scriptHash) throw new CallError(gateMessage.script_changed, 409);
  const at = now(deps);
  // One live approval per plan: approving again cancels the earlier, unused one.
  for (const a of callStore.approvals.values()) if (a.callPlanId === plan.id && a.status === "active") saveApproval({ ...a, status: "revoked" });
  let approval: CallApproval;
  try {
    approval = approveCallPlan(plan, p.data.approvedBy, at);
  } catch (err) {
    throw new CallError((err as Error).message, 409);
  }
  saveApproval(approval);
  return approval;
}

// ---------- POST /api/calls ----------

const StartBody = z.object({ planId: z.string().min(1), approvalId: z.string().min(1) });

export async function startCall(body: unknown, deps: CallDeps = {}): Promise<{ attempt: CallAttempt; approval: CallApproval }> {
  const p = StartBody.safeParse(body);
  if (!p.success) throw new CallError("Send { planId, approvalId }.", 422);
  const cfg = cartesiaCallConfig(env(deps));
  const line = rolePlayLine(env(deps));
  const plan = callStore.plans.get(p.data.planId);
  if (!plan) throw new CallError("This call plan isn't on this server (it may have restarted). Prepare the call plan again.", 404);

  // Never trust a client approval: only the server's stored copy counts.
  const stored = callStore.approvals.get(p.data.approvalId) ?? null;
  const at = now(deps);
  const gate = checkCallGate(stored, plan, at);
  if (!gate.ok) {
    if (gate.reason === "expired" && stored?.status === "active") saveApproval({ ...stored, status: "expired" });
    throw new CallError(gateMessage[gate.reason], 409);
  }
  const approval = stored!;
  if (!plan.rolePlay || plan.phoneNumber !== line.phone)
    throw new CallError("The role-play number changed after you approved. Prepare and approve the call again.", 409);

  // Consume before the first await, so a double click can't place a second call.
  const used = consumeApproval(approval);
  saveApproval(used);

  const attempt: CallAttempt = {
    id: newId("call"),
    approvalId: approval.id,
    callPlanId: plan.id,
    state: "dialing",
    mode: "role_play",
    startedAt: at.toISOString(),
    transcript: [],
    origin: CALL_ORIGIN,
  };
  const rec: AttemptRecord = { attempt, plan, outcome: null, lastPolledAt: at.getTime() };
  saveAttempt(rec);

  try {
    const { agentCallId } = await dialWithRetry(deps, () =>
      createOutboundCall(
        { apiKey: cfg.apiKey, fetchImpl: deps.fetchImpl },
        { agentId: cfg.agentId, fromNumberId: cfg.fromNumberId, toNumber: plan.phoneNumber, dynamicVariables: scriptVariables(plan, attempt.id), maxCallDurationMinutes: MAX_CALL_MINUTES },
      ),
    );
    rec.attempt = { ...rec.attempt, providerCallId: agentCallId };
  } catch (err) {
    const msg = err instanceof CartesiaApiError ? err.message : "Unexpected error";
    console.error("[calls] dial failed", attempt.id, msg);
    rec.attempt = {
      ...rec.attempt,
      state: "failed",
      endedAt: now(deps).toISOString(),
      failureReason: /didn't answer in time/.test(msg)
        ? "Cartesia didn't confirm the call in time, so it may or may not have rung. Check the Cartesia call log before approving again."
        : `The call couldn't be started: ${msg}. Your approval was used for this one attempt.`,
    };
  }
  rec.attempt = CallAttemptSchema.parse(rec.attempt);
  saveAttempt(rec);
  return { attempt: rec.attempt, approval: used };
}

async function dialWithRetry<T>(deps: CallDeps, fn: () => Promise<T>): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof CartesiaApiError) || !err.retryable || n >= MAX_DIAL_ATTEMPTS) throw err;
      await new Promise((r) => setTimeout(r, deps.retryDelayMs ?? 750));
    }
  }
}

/** Dynamic variables for the agent's greeting and instructions (see VENDOR_AGENT_SETUP). */
export function scriptVariables(plan: CallPlan, attemptId: string): Record<string, string> {
  return {
    mela_disclosure: plan.disclosure,
    mela_opening: plan.opening,
    mela_questions: plan.questions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
    mela_shared_details: plan.sharedDetails.map((d) => `${d.label}: ${d.value}`).join("; "),
    mela_must_not: plan.mustNotAgreeTo.join("; "),
    mela_vendor_name: plan.vendorName,
    mela_attempt_id: attemptId,
  };
}

// ---------- GET /api/calls/:attemptId ----------

export async function getCall(attemptId: string, deps: CallDeps = {}) {
  const rec = callStore.attempts.get(attemptId);
  if (!rec) throw new CallError("This call isn't on this server (it may have restarted).", 404);
  const t = now(deps).getTime();
  if (!TERMINAL.has(rec.attempt.state) && rec.attempt.providerCallId) {
    if (rec.polling) await rec.polling;
    else if (t - rec.lastPolledAt >= (deps.pollEveryMs ?? 1500)) {
      rec.lastPolledAt = t;
      rec.polling = pollProvider(rec, deps).finally(() => (rec.polling = undefined));
      await rec.polling;
    }
  }
  if (!TERMINAL.has(rec.attempt.state) && t - Date.parse(rec.attempt.startedAt) > GIVE_UP_MS) {
    finish(rec, { state: "failed", failureReason: "Cartesia never reported how this call ended. Check the Cartesia call log." }, deps);
  }
  return { attempt: rec.attempt, outcome: rec.outcome };
}

async function pollProvider(rec: AttemptRecord, deps: CallDeps) {
  let cfg;
  try {
    cfg = cartesiaCallConfig(env(deps));
  } catch {
    return; // keys removed mid-call: keep the last known state; the webhook may still arrive
  }
  try {
    const call = await getAgentCall({ apiKey: cfg.apiKey, fetchImpl: deps.fetchImpl, timeoutMs: 4000 }, rec.attempt.providerCallId!);
    applyProviderCall(rec, call, deps);
  } catch (err) {
    console.error("[calls] status poll failed", rec.attempt.id, (err as Error).message); // next poll tries again
  }
}

// ---------- provider state → attempt ----------

const NOT_REACHED: Record<string, string> = {
  dial_no_answer: "No one answered.",
  dial_busy: "The line was busy.",
  dial_timeout: "The call rang out without an answer.",
  voicemail_detected: "The call reached voicemail, so Mela hung up without leaving a message.",
};

function finish(rec: AttemptRecord, patch: Partial<CallAttempt>, deps: CallDeps) {
  rec.attempt = CallAttemptSchema.parse({ ...rec.attempt, endedAt: rec.attempt.endedAt ?? now(deps).toISOString(), ...patch });
  saveAttempt(rec);
}

/** Apply a Cartesia AgentCall (from GET /agents/calls/{id} or a webhook) to our attempt. Terminal attempts never change. */
export function applyProviderCall(rec: AttemptRecord, call: AgentCall, deps: CallDeps = {}) {
  if (TERMINAL.has(rec.attempt.state)) return;
  const transcript = toTranscript(call.transcript);
  if (transcript.length) rec.attempt = { ...rec.attempt, transcript };

  if (call.status === "created") return saveAttempt(rec);
  if (call.status === "started") {
    rec.attempt = { ...rec.attempt, state: "connected" };
    return saveAttempt(rec);
  }
  if (call.status !== "completed" && call.status !== "failed") return;

  const endedAt = call.end_time ?? undefined;
  const to = call.telephony_params?.to;
  if (to && /\d/.test(to) && digits(to) !== digits(rec.plan.phoneNumber)) {
    return finish(rec, { state: "failed", endedAt, failureReason: "Cartesia reports a different number was called than the one you approved, so the answers were not used." }, deps);
  }
  const reason = call.end_reason ?? "";
  if (NOT_REACHED[reason]) return finish(rec, { state: "not_contacted", endedAt, failureReason: NOT_REACHED[reason] }, deps);

  const heard = rec.attempt.transcript.some((t) => t.speaker === "vendor");
  if (heard && !openedWithDisclosure(rec.plan, rec.attempt.transcript)) {
    return finish(rec, { state: "failed", endedAt, failureReason: "The call didn't open with Mela's AI disclosure, so none of its answers were kept." }, deps);
  }
  // A finished call always gets an outcome (unasked questions show as not answered); a failed one only if the vendor spoke.
  if (heard || call.status === "completed") rec.outcome = outcomeFromTranscript(rec.attempt.id, rec.plan, rec.attempt.transcript, now(deps));
  if (call.status === "failed") {
    return finish(rec, { state: "failed", endedAt, failureReason: `The call ended with an error${call.error_message ? `: ${call.error_message}` : reason ? ` (${reason})` : ""}.` }, deps);
  }
  finish(rec, { state: "completed", endedAt }, deps);
}

// ---------- POST /api/calls/webhook ----------

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function handleWebhook(req: Request, deps: CallDeps = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const secret = webhookSecret(env(deps));
  if (!secret) return { status: 503, body: { error: "Cartesia webhooks aren't connected: CARTESIA_WEBHOOK_SECRET is not set." } };
  const given = req.headers.get("x-webhook-secret") ?? "";
  if (!sameSecret(given, secret)) return { status: 401, body: { error: "unauthorized" } };

  const p = WebhookEvent.safeParse(await req.json().catch(() => null));
  if (!p.success) return { status: 400, body: { error: "Not a Cartesia call event." } };
  const ev = p.data;
  if (ev.webhook_request_id && callStore.seenWebhooks.has(ev.webhook_request_id)) return { status: 200, body: { ok: true, duplicate: true } };

  const attemptId = callStore.byProviderId.get(ev.call_id);
  const rec = attemptId ? callStore.attempts.get(attemptId) : undefined;
  const agentId = env(deps).CARTESIA_AGENT_ID?.trim();
  // 200 for calls that aren't ours, so Cartesia doesn't retry them.
  if (!rec || (agentId && ev.agent_id && ev.agent_id !== agentId)) return { status: 200, body: { ok: true, ignored: true } };

  if (ev.type === "call_started") {
    applyProviderCall(rec, { ...(ev.call ?? { id: ev.call_id }), status: "started" }, deps);
  } else if (ev.type === "call_turn" && ev.turn && !TERMINAL.has(rec.attempt.state)) {
    const [turn] = toTranscript([ev.turn]);
    if (turn) rec.attempt = { ...rec.attempt, state: "connected", transcript: [...rec.attempt.transcript, turn] };
    saveAttempt(rec);
  } else if (ev.type === "call_completed" || ev.type === "call_failed") {
    const fallbackStatus = ev.type === "call_completed" ? "completed" : "failed";
    applyProviderCall(rec, { ...(ev.call ?? { id: ev.call_id }), status: ev.call?.status === "completed" || ev.call?.status === "failed" ? ev.call.status : fallbackStatus }, deps);
  }
  firstDelivery(ev.webhook_request_id); // mark only after it was applied, so a failed delivery is retried
  return { status: 200, body: { ok: true } };
}

// ---------- route helper ----------

export async function respond(fn: () => unknown | Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn());
  } catch (err) {
    if (err instanceof CallError) return Response.json({ error: err.message }, { status: err.status });
    if (err instanceof NotConnectedError) return Response.json({ error: err.message }, { status: 501 });
    console.error("[calls] unexpected error", (err as Error)?.message);
    return Response.json({ error: "Something went wrong on the server with this call." }, { status: 500 });
  }
}
