// Route-level tests for the host-approved call endpoints. No network: global fetch is a fake.
// Run: npm run test:calls  (needs --conditions=react-server for the server-only modules)
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { POST as postPlan } from "../../src/app/api/calls/plans/route";
import { POST as postApproval } from "../../src/app/api/calls/approvals/route";
import { POST as postCall } from "../../src/app/api/calls/route";
import { GET as getCallRoute } from "../../src/app/api/calls/[attemptId]/route";
import { POST as postWebhook } from "../../src/app/api/calls/webhook/route";
import { callStore, resetCallStore } from "../../src/lib/calls/store";
import { getCall } from "../../src/lib/calls/service";
import { createJob } from "../../src/lib/research/job";
import { DISCLOSURE, editCallPlan } from "../../src/mela/domain/calls";
import type { CallApproval, CallAttempt, CallOutcome, CallPlan, EventBrief } from "../../src/mela/contracts";
import { demoBrief } from "../mela-helpers";

const ROLEPLAY = "+15105550142";
const VENDOR_LISTED = "+14155550100";
const KEYS = { CARTESIA_API_KEY: "test-key", CARTESIA_AGENT_ID: "agent_test", CARTESIA_FROM_NUMBER_ID: "ap_test", CARTESIA_WEBHOOK_SECRET: "whsec_test" };
const ENV_NAMES = ["MELA_ROLEPLAY_PHONE", "MELA_ROLEPLAY_LABEL", ...Object.keys(KEYS)];

type FetchCall = { url: string; method: string; headers: Record<string, string>; body: unknown };
let fetchCalls: FetchCall[] = [];
let fetchReplies: ((c: FetchCall) => Response)[] = [];
const realFetch = globalThis.fetch;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_NAMES) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  resetCallStore();
  fetchCalls = [];
  fetchReplies = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const c: FetchCall = { url: String(url), method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
    fetchCalls.push(c);
    const reply = fetchReplies.shift();
    if (!reply) throw new Error(`unexpected network call to ${url}`);
    return reply(c);
  }) as typeof fetch;
  seedResearch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_NAMES) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const connect = (extra: Record<string, string> = {}) => Object.assign(process.env, { MELA_ROLEPLAY_PHONE: ROLEPLAY, ...KEYS, ...extra });
const json = (body: unknown, status = 200) => () => Response.json(body, { status });
const req = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

/** A settled live-research job holding one venue, the way /api/research leaves it. */
function seedResearch(brief: EventBrief = demoBrief()) {
  const job = createJob("job_test", brief);
  job.vendors.set("v_venue", { id: "v_venue", name: "Harbor Hall", category: "venue", website: "https://harbor.example", phone: VENDOR_LISTED, mapsUrl: "https://maps.example/harbor" });
  job.sources.set("s1", { id: "s1", url: "https://harbor.example", provider: "bd_unlocker", sourceType: "venue_site", status: "found", attempt: 1 });
  job.sourceVendor.set("s1", "v_venue");
  job.done = true;
  const g = globalThis as typeof globalThis & { __melaResearchJobs?: Map<string, unknown> };
  (g.__melaResearchJobs ??= new Map()).clear();
  g.__melaResearchJobs.set(job.id, job);
}

async function makePlan(): Promise<CallPlan> {
  const res = await postPlan(req("/api/calls/plans", { brief: demoBrief(), vendorId: "v_venue" }));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  return res.json();
}
async function makeApproval(plan: CallPlan): Promise<CallApproval> {
  const res = await postApproval(req("/api/calls/approvals", { planId: plan.id, planVersion: plan.version, scriptHash: plan.scriptHash, approvedBy: "Host" }));
  assert.equal(res.status, 200);
  return res.json();
}
const dial = (plan: CallPlan, approvalId: string, extra: object = {}) => postCall(req("/api/calls", { planId: plan.id, approvalId, ...extra }));
const accepted = (id = "ac_test_1") => json({ calls: [{ number: ROLEPLAY, agent_call_id: id }] });

async function placedCall() {
  connect();
  const plan = await makePlan();
  const approved = await makeApproval(plan);
  fetchReplies.push(accepted());
  const res = await dial(plan, approved.id);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { attempt: CallAttempt; approval: CallApproval };
  return { plan, ...body };
}

const hook = (event: object, secret = KEYS.CARTESIA_WEBHOOK_SECRET) => postWebhook(req("/api/calls/webhook", event, { "x-webhook-secret": secret }));
const turns = (plan: CallPlan, answers: string[], opening = DISCLOSURE) => [
  { role: "assistant", text: opening, start_timestamp: 0, end_timestamp: 4 },
  { role: "user", text: "Sure, go ahead.", start_timestamp: 4, end_timestamp: 5 },
  ...plan.questions.flatMap((q, i) => [
    { role: "assistant", text: q, start_timestamp: 6 + i * 4, end_timestamp: 7 + i * 4 },
    ...(answers[i] ? [{ role: "user", text: answers[i], start_timestamp: 8 + i * 4, end_timestamp: 9 + i * 4 }] : []),
  ]),
];
const completed = (plan: CallPlan, answers: string[], over: Record<string, unknown> = {}, id = "ac_test_1") => ({
  type: "call_completed",
  call_id: id,
  agent_id: KEYS.CARTESIA_AGENT_ID,
  webhook_request_id: `req_${Math.random()}`,
  call: { id, agent_id: KEYS.CARTESIA_AGENT_ID, status: "completed", end_reason: "agent_hangup", end_time: new Date().toISOString(), telephony_params: { to: ROLEPLAY, direction: "outbound" }, transcript: turns(plan, answers), ...over },
});
async function status(attemptId: string) {
  const res = await getCallRoute(new Request(`http://localhost/api/calls/${attemptId}`), { params: Promise.resolve({ attemptId }) });
  return { code: res.status, body: (await res.json()) as { attempt: CallAttempt; outcome: CallOutcome | null; error?: string } };
}

// ---------- plans ----------

test("plan: not connected (501) until the role-play number is set", async () => {
  const res = await postPlan(req("/api/calls/plans", { brief: demoBrief(), vendorId: "v_venue" }));
  assert.equal(res.status, 501);
  assert.match((await res.json()).error, /MELA_ROLEPLAY_PHONE/);
});

test("plan: built from the live research vendor, dialing only the role-play line", async () => {
  connect();
  const plan = await makePlan();
  assert.equal(plan.vendorName, "Harbor Hall");
  assert.equal(plan.phoneNumber, ROLEPLAY);
  assert.notEqual(plan.phoneNumber, VENDOR_LISTED);
  assert.equal(plan.rolePlay, true);
  assert.equal(plan.disclosure, DISCLOSURE);
  assert.ok(!plan.sharedDetails.some((d) => /budget/i.test(d.label)));
  assert.ok(callStore.plans.has(plan.id));
});

test("plan: refuses an unconfirmed brief (409), unknown vendor (404), bad body (422)", async () => {
  connect();
  const unconfirmed = await postPlan(req("/api/calls/plans", { brief: { ...demoBrief(), confirmedAt: null }, vendorId: "v_venue" }));
  assert.equal(unconfirmed.status, 409);
  const unknown = await postPlan(req("/api/calls/plans", { brief: demoBrief(), vendorId: "v-lakeview-loft" }));
  assert.equal(unknown.status, 404);
  assert.match((await unknown.json()).error, /live research/);
  const bad = await postPlan(req("/api/calls/plans", { vendorId: "v_venue" }));
  assert.equal(bad.status, 422);
});

test("plan: refuses when the role-play number is the vendor's own listed number", async () => {
  connect({ MELA_ROLEPLAY_PHONE: VENDOR_LISTED });
  const res = await postPlan(req("/api/calls/plans", { brief: demoBrief(), vendorId: "v_venue" }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /teammate/);
});

test("plan: a non-E.164 role-play number is not connected", async () => {
  connect({ MELA_ROLEPLAY_PHONE: "(510) 555-0142" });
  const res = await postPlan(req("/api/calls/plans", { brief: demoBrief(), vendorId: "v_venue" }));
  assert.equal(res.status, 501);
});

// ---------- approvals ----------

test("approval: binds the server's plan; wrong version or hash is refused", async () => {
  connect();
  const plan = await makePlan();
  const stale = await postApproval(req("/api/calls/approvals", { planId: plan.id, planVersion: plan.version + 1, scriptHash: plan.scriptHash, approvedBy: "Host" }));
  assert.equal(stale.status, 409);
  const hash = await postApproval(req("/api/calls/approvals", { planId: plan.id, planVersion: plan.version, scriptHash: "deadbeef", approvedBy: "Host" }));
  assert.equal(hash.status, 409);
  assert.match((await hash.json()).error, /script changed/);
  const missing = await postApproval(req("/api/calls/approvals", { planId: "plan_nope", planVersion: 1, scriptHash: plan.scriptHash, approvedBy: "Host" }));
  assert.equal(missing.status, 404);
  const noName = await postApproval(req("/api/calls/approvals", { planId: plan.id, planVersion: plan.version, scriptHash: plan.scriptHash, approvedBy: " " }));
  assert.equal(noName.status, 422);

  const a = await makeApproval(plan);
  assert.equal(a.callPlanId, plan.id);
  assert.equal(a.phoneNumber, ROLEPLAY);
  assert.equal(a.maxAttempts, 1);
  assert.equal(Date.parse(a.expiresAt) - Date.parse(a.approvedAt), 15 * 60 * 1000);
  assert.deepEqual(callStore.approvals.get(a.id), a);
});

test("approval: approving again revokes the earlier unused approval", async () => {
  connect();
  const plan = await makePlan();
  const first = await makeApproval(plan);
  await makeApproval(plan);
  assert.equal(callStore.approvals.get(first.id)?.status, "revoked");
  const res = await dial(plan, first.id);
  assert.equal(res.status, 409);
  assert.equal(fetchCalls.length, 0);
});

// ---------- placing the call ----------

test("call: 501 when Cartesia isn't configured, and the approval is not used up", async () => {
  process.env.MELA_ROLEPLAY_PHONE = ROLEPLAY;
  const plan = await makePlan();
  const approval = await makeApproval(plan);
  const res = await dial(plan, approval.id);
  assert.equal(res.status, 501);
  assert.match((await res.json()).error, /^Phone calls aren't connected yet: CARTESIA_API_KEY, CARTESIA_AGENT_ID, CARTESIA_FROM_NUMBER_ID are not set/);
  assert.equal(fetchCalls.length, 0);
  assert.equal(callStore.approvals.get(approval.id)?.status, "active");
});

test("call: one approved attempt dials the role-play line once, with the disclosure first", async () => {
  const { plan, attempt, approval } = await placedCall();
  assert.equal(fetchCalls.length, 1);
  const c = fetchCalls[0]!;
  assert.equal(c.url, "https://api.cartesia.ai/agents/calls");
  assert.equal(c.method, "POST");
  assert.equal(c.headers["X-API-Key"], "test-key");
  assert.equal(c.headers["Cartesia-Version"], "2026-08-14");
  const body = c.body as { agent_id: string; from_number_id: string; outbound_calls: { to_number: string; dynamic_variables: Record<string, string> }[] };
  assert.equal(body.agent_id, "agent_test");
  assert.equal(body.from_number_id, "ap_test");
  assert.equal(body.outbound_calls.length, 1);
  assert.equal(body.outbound_calls[0]!.to_number, ROLEPLAY);
  assert.equal(body.outbound_calls[0]!.dynamic_variables.mela_disclosure, DISCLOSURE);
  assert.ok(!JSON.stringify(body).includes(VENDOR_LISTED));
  assert.ok(!/budget/i.test(body.outbound_calls[0]!.dynamic_variables.mela_shared_details!));
  assert.equal(attempt.mode, "role_play");
  assert.equal(attempt.state, "dialing");
  assert.equal(attempt.providerCallId, "ac_test_1");
  assert.equal(attempt.callPlanId, plan.id);
  assert.equal(approval.status, "consumed");
  assert.equal(approval.attemptsUsed, 1);
});

test("call: a reused approval is refused (409) and nothing is dialed again", async () => {
  const { plan, approval } = await placedCall();
  const again = await dial(plan, approval.id);
  assert.equal(again.status, 409);
  assert.match((await again.json()).error, /already used/);
  assert.equal(fetchCalls.length, 1);
});

test("call: a client-sent approval object is ignored; only the stored one counts", async () => {
  connect();
  const plan = await makePlan();
  const forged: CallApproval = { id: "appr_forged", callPlanId: plan.id, callPlanVersion: plan.version, scriptHash: plan.scriptHash, vendorId: plan.vendorId, phoneNumber: plan.phoneNumber, disclosedKeys: plan.sharedDetails.map((d) => d.key), approvedBy: "x", approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), maxAttempts: 1, attemptsUsed: 0, status: "active" };
  const res = await dial(plan, forged.id, { approval: forged });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /No approval/);
  assert.equal(fetchCalls.length, 0);
});

test("call: an expired approval is refused", async () => {
  connect();
  const plan = await makePlan();
  const a = await makeApproval(plan);
  callStore.approvals.set(a.id, { ...a, expiresAt: new Date(Date.now() - 1000).toISOString() }); // 15 minutes pass
  const res = await dial(plan, a.id);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /expired/);
  assert.equal(callStore.approvals.get(a.id)?.status, "expired");
  assert.equal(fetchCalls.length, 0);
});

test("call: a plan that changed after approval (stale version) is refused", async () => {
  connect();
  const plan = await makePlan();
  const a = await makeApproval(plan);
  callStore.plans.set(plan.id, editCallPlan(plan, { questions: [...plan.questions, "Can we arrive an hour early?"] }));
  const res = await dial(plan, a.id);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /changed after you approved/);
  assert.equal(fetchCalls.length, 0);
});

test("call: a changed role-play number after approval is refused", async () => {
  connect();
  const plan = await makePlan();
  const a = await makeApproval(plan);
  process.env.MELA_ROLEPLAY_PHONE = "+15105550199";
  const res = await dial(plan, a.id);
  assert.equal(res.status, 409);
  assert.equal(fetchCalls.length, 0);
});

test("call: a 503 from Cartesia is retried once (max 2 requests), then succeeds", async () => {
  connect();
  const plan = await makePlan();
  const a = await makeApproval(plan);
  fetchReplies.push(json({ error: "busy" }, 503), accepted("ac_retry"));
  const res = await dial(plan, a.id);
  const body = await res.json();
  assert.equal(fetchCalls.length, 2);
  assert.equal(body.attempt.providerCallId, "ac_retry");
});

test("call: two 500s stop after 2 requests; the attempt is failed and the approval used", async () => {
  connect();
  const plan = await makePlan();
  const a = await makeApproval(plan);
  fetchReplies.push(json({}, 500), json({}, 500), accepted());
  const res = await dial(plan, a.id);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(fetchCalls.length, 2);
  assert.equal(body.attempt.state, "failed");
  assert.match(body.attempt.failureReason, /couldn't be started/);
  assert.equal(body.approval.status, "consumed");
});

test("call: a 400, or a per-destination error inside a 200, is not retried", async () => {
  connect();
  const plan = await makePlan();
  const a1 = await makeApproval(plan);
  fetchReplies.push(json({ message: "bad agent" }, 400));
  assert.equal((await (await dial(plan, a1.id)).json()).attempt.state, "failed");
  assert.equal(fetchCalls.length, 1);
  const a2 = await makeApproval(plan);
  fetchReplies.push(json({ calls: [{ number: ROLEPLAY, error: { message: "concurrency limit" } }] }));
  const r2 = await (await dial(plan, a2.id)).json();
  assert.equal(r2.attempt.state, "failed");
  assert.match(r2.attempt.failureReason, /concurrency limit/);
  assert.equal(fetchCalls.length, 2);
});

// ---------- status + webhook ----------

test("status: unknown attempt is 404", async () => {
  const r = await status("call_missing");
  assert.equal(r.code, 404);
});

test("webhook: 503 without a secret configured, 401 with the wrong secret", async () => {
  const { plan } = await placedCall();
  delete process.env.CARTESIA_WEBHOOK_SECRET;
  assert.equal((await hook(completed(plan, []))).status, 503);
  process.env.CARTESIA_WEBHOOK_SECRET = KEYS.CARTESIA_WEBHOOK_SECRET;
  assert.equal((await hook(completed(plan, []), "wrong")).status, 401);
});

test("webhook: started → connected; turns stream in; completed → verified verbal answers, never booked", async () => {
  const { plan, attempt } = await placedCall();
  assert.equal((await hook({ type: "call_started", call_id: "ac_test_1", agent_id: "agent_test", webhook_request_id: "w1", call: { id: "ac_test_1", status: "started" } })).status, 200);
  assert.equal((await status(attempt.id)).body.attempt.state, "connected");
  await hook({ type: "call_turn", call_id: "ac_test_1", agent_id: "agent_test", webhook_request_id: "w2", turn: { role: "assistant", text: DISCLOSURE, start_timestamp: 0, end_timestamp: 3 } });
  assert.equal((await status(attempt.id)).body.attempt.transcript[0]?.speaker, "mela");

  const answers = [
    "Yes, that Saturday is open. I'll put you down as booked!",
    ...plan.questions.slice(1).map((q) => (/rental fee/i.test(q) ? "It's $1,200 for five hours, cleaning included." : "")),
  ];
  const res = await hook(completed(plan, answers));
  assert.equal(res.status, 200);
  const { body } = await status(attempt.id);
  assert.equal(body.attempt.state, "completed");
  assert.equal(body.attempt.mode, "role_play");
  const o = body.outcome!;
  assert.ok(o);
  assert.equal(o.availability, "vendor_said_verbally");
  assert.ok(!["booked", "written_confirmation"].includes(o.availability));
  assert.equal(o.answers[0]!.status, "vendor_said_verbally");
  assert.equal(o.answers[0]!.answer, answers[0]);
  const vendorText = body.attempt.transcript.filter((t) => t.speaker === "vendor").map((t) => t.text);
  for (const a of o.answers) {
    if (a.status === "vendor_said_verbally") assert.ok(vendorText.some((t) => t.includes(a.answer!)), `answer must be verbatim: ${a.answer}`);
    else assert.equal(a.answer, null);
  }
  const feeIdx = plan.questions.findIndex((q) => /rental fee/i.test(q));
  assert.equal(o.answers[feeIdx]!.answer, "It's $1,200 for five hours, cleaning included.");
  assert.equal(o.price?.priceType, "verbal");
  assert.equal(o.price?.amountCents, 120000);
  assert.ok(o.answers.some((a) => a.status === "not_answered"));
  assert.ok(o.followUps.some((f) => /in writing/.test(f)));
});

test("webhook: duplicate deliveries are ignored and a finished call never changes", async () => {
  const { plan, attempt } = await placedCall();
  const ev = completed(plan, ["Yes, it's open."]);
  await hook(ev);
  const first = (await status(attempt.id)).body;
  const dup = await (await hook(ev)).json();
  assert.equal(dup.duplicate, true);
  await hook({ ...completed(plan, ["No, sorry."]), webhook_request_id: "other" });
  assert.deepEqual((await status(attempt.id)).body, first);
});

test("webhook: a call that didn't open with the AI disclosure keeps no answers", async () => {
  const { plan, attempt } = await placedCall();
  await hook(completed(plan, ["Yes, it's open."], { transcript: turns(plan, ["Yes, it's open."], "Hello, I'm calling about an event.") }));
  const { body } = await status(attempt.id);
  assert.equal(body.attempt.state, "failed");
  assert.match(body.attempt.failureReason!, /disclosure/);
  assert.equal(body.outcome, null);
});

test("webhook: a call to a different number than approved keeps no answers", async () => {
  const { plan, attempt } = await placedCall();
  await hook(completed(plan, ["Yes, it's open."], { telephony_params: { to: VENDOR_LISTED } }));
  const { body } = await status(attempt.id);
  assert.equal(body.attempt.state, "failed");
  assert.equal(body.outcome, null);
});

test("webhook: no answer → not contacted; events for unknown calls are acknowledged and ignored", async () => {
  const { plan, attempt } = await placedCall();
  await hook(completed(plan, [], { status: "failed", end_reason: "dial_no_answer", transcript: [] }));
  const { body } = await status(attempt.id);
  assert.equal(body.attempt.state, "not_contacted");
  assert.equal(body.outcome, null);
  const other = await (await hook({ ...completed(plan, []), call_id: "ac_someone_else" })).json();
  assert.equal(other.ignored, true);
});

test("status poll: reads GET /agents/calls/{id} when no webhook arrives", async () => {
  const { plan, attempt } = await placedCall();
  const call = completed(plan, ["Yes, that date is available."]).call;
  fetchReplies.push(json(call));
  const r = await getCall(attempt.id, { pollEveryMs: 0 });
  assert.equal(fetchCalls.at(-1)!.url, "https://api.cartesia.ai/agents/calls/ac_test_1");
  assert.equal(fetchCalls.at(-1)!.method, "GET");
  assert.equal(r.attempt.state, "completed");
  assert.equal(r.outcome?.answers[0]?.answer, "Yes, that date is available.");
  assert.equal(r.outcome?.availability, "vendor_said_verbally");
});

test("status poll: a failed poll keeps the last state and does not throw", async () => {
  const { attempt } = await placedCall();
  fetchReplies.push(json({ error: "oops" }, 500));
  const r = await getCall(attempt.id, { pollEveryMs: 0 });
  assert.equal(r.attempt.state, "dialing");
});
