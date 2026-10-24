import { test, mock } from "node:test"; import assert from "node:assert/strict";
import { cartesiaClient, cartesiaCalls, finalTranscript, pollUntilEnded, scriptVariables, transcriptText, type CartesiaClient } from "@/integrations/cartesia";
import type { Store } from "@/lib/store";
import type { CallScript } from "@/lib/types";

const env = { CARTESIA_API_KEY: "k" } as unknown as NodeJS.ProcessEnv;
const script: CallScript = { opening: "Hi", questions: ["Free on May 3?", "Price?"], closing: "Thanks", mustNotAgreeTo: ["deposits", "contracts"] };
const fake = (status: number, json: unknown) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;
  return { f, calls };
};
const args = { fromNumberId: "ap_1", agentId: "agent_1", toNumber: "+15550000001", variables: { mela_call_id: "m1" } };
const lines = [{ role: "assistant", text: "Hi" }, { role: "user", text: "Hello" }];
const noSleep = async () => {};

test("cartesiaClient throws without an API key", () => {
  assert.throws(() => cartesiaClient({} as unknown as NodeJS.ProcessEnv), /Cartesia not configured/);
});

test("placeCall posts headers and body, returns agent_call_id", async () => {
  const { f, calls } = fake(200, { calls: [{ number: "+15550000001", agent_call_id: "ac_1" }] });
  assert.deepEqual(await cartesiaClient(env, f).placeCall(args), { agentCallId: "ac_1" });
  assert.equal(calls[0].url, "https://api.cartesia.ai/agents/calls");
  const h = calls[0].init.headers as Record<string, string>;
  assert.equal(h["X-API-Key"], "k"); assert.equal(h.Authorization, "Bearer k"); assert.equal(h["Cartesia-Version"], "2026-08-14");
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.from_number_id, "ap_1"); assert.equal(body.agent_id, "agent_1");
  assert.equal(body.outbound_calls[0].to_number, "+15550000001");
  assert.equal(body.outbound_calls[0].dynamic_variables.mela_call_id, "m1");
});

test("placeCall throws calls[0].error and non-2xx", async () => {
  await assert.rejects(cartesiaClient(env, fake(200, { calls: [{ number: "x", error: "invalid number" }] }).f).placeCall(args), /invalid number/);
  await assert.rejects(cartesiaClient(env, fake(500, { oops: 1 }).f).placeCall(args), /cartesia 500/);
});

test("scriptVariables joins questions and rules", () => {
  assert.deepEqual(scriptVariables("vendor", script, "m1"), { call_kind: "vendor", opening: "Hi", questions: "Free on May 3? | Price?",
    closing: "Thanks", must_not_agree_to: "deposits, contracts", mela_call_id: "m1" });
});

test("transcriptText and finalTranscript", () => {
  assert.equal(transcriptText(lines), "Agent: Hi\nCallee: Hello");
  assert.equal(transcriptText(null), "");
  assert.equal(finalTranscript({ status: "started", endReason: null, transcript: lines }), null);
  assert.equal(finalTranscript({ status: "completed", endReason: "agent_end_call", transcript: lines }), "Agent: Hi\nCallee: Hello");
  assert.equal(finalTranscript({ status: "completed", endReason: "dial_no_answer", transcript: null }), "No answer.");
  assert.equal(finalTranscript({ status: "failed", endReason: "error", transcript: [] }), "Call did not complete.");
});

const scripted = (steps: (string | Error)[]) => ({
  getCall: async () => {
    const s = steps.shift()!;
    if (s instanceof Error) throw s;
    return { status: s, endReason: null, transcript: s === "completed" ? lines : null };
  },
}) as unknown as CartesiaClient;

test("pollUntilEnded calls onDone once when the call completes, retrying errors", async () => {
  for (const steps of [["started", "started", "completed"], [new Error("cartesia 502"), "completed"]]) {
    const got: string[] = [];
    await pollUntilEnded(scripted(steps), "ac_1", async (t) => { got.push(t); }, { sleep: noSleep });
    assert.deepEqual(got, ["Agent: Hi\nCallee: Hello"]);
  }
});

test("pollUntilEnded gives up after maxMs", async () => {
  const got: string[] = [];
  const c = { getCall: async () => ({ status: "started", endReason: null, transcript: null }) } as unknown as CartesiaClient;
  await pollUntilEnded(c, "ac_1", async (t) => { got.push(t); }, { sleep: noSleep, intervalMs: 5, maxMs: 20 });
  assert.deepEqual(got, ["Call did not complete."]);
});

test("cartesiaCalls places a vendor call and reports the transcript", async () => {
  const store = { getVendor: async () => ({ phone: "(555) 000-0001" }) } as unknown as Store;
  const placed: unknown[] = [];
  const client = { placeCall: async (a: unknown) => { placed.push(a); return { agentCallId: "ac_1" }; },
    getCall: async () => ({ status: "completed", endReason: null, transcript: lines }) } as unknown as CartesiaClient;
  const ended: [string, string][] = [];
  Object.assign(process.env, { CARTESIA_AGENT_ID: "agent_1", CARTESIA_PHONE_NUMBER_ID: "ap_1" });
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const r = await cartesiaCalls(async (id, t) => { ended.push([id, t]); }, store, client).callVendor("e1", "v1", script);
    assert.equal(r.providerCallId, "ac_1");
    assert.equal((placed[0] as { toNumber: string }).toNumber, "+15550000001");
    assert.equal((placed[0] as { variables: Record<string, string> }).variables.mela_call_id, r.callId);
    mock.timers.tick(5000);
    for (let i = 0; i < 5; i++) await new Promise((res) => setImmediate(res));
    assert.deepEqual(ended, [[r.callId, "Agent: Hi\nCallee: Hello"]]);
  } finally {
    mock.timers.reset();
    delete process.env.CARTESIA_AGENT_ID; delete process.env.CARTESIA_PHONE_NUMBER_ID;
  }
  await assert.rejects(cartesiaCalls(async () => {}, store, client).callVendor("e1", "v1", script), /run npm run cartesia:setup/);
});
