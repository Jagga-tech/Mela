import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeChannel } from "../src/integrations/fakeChannel";
import { getChannel } from "../src/integrations/channel";
import { ensureDisclosure, DISCLOSURE } from "../src/agents/outreach";
import { store } from "../src/lib/store";
import type { CallScript } from "../src/lib/types";

const script: CallScript = { opening: "Hello", questions: ["q"], closing: "bye", mustNotAgreeTo: [] };
const tick = () => new Promise((r) => setImmediate(r));

test("fakeChannel vendor call delivers seed transcript", async () => {
  const got: [string, string][] = [];
  const ch = fakeChannel(async (id, t) => { got.push([id, t]); }, store.seed);
  const { callId } = await ch.callVendor("e", "venue-casa-verde", script);
  await tick();
  assert.deepEqual(got, [[callId, store.seed.transcripts.vendors["venue-casa-verde"]]]);
  await ch.callVendor("e", "nope", script);
  await tick();
  assert.equal(got[1][1], "No answer.");
});

test("fakeChannel host call and text sink", async () => {
  const got: string[] = [];
  const sent: string[] = [];
  const ch = fakeChannel(async (_id, t) => { got.push(t); }, store.seed, (to, b) => sent.push(`${to}|${b}`));
  await ch.callHost("e", "host_confirm", script);
  await tick();
  assert.deepEqual(got, [store.seed.transcripts.host_confirm]);
  await ch.text("+1", "hi");
  assert.deepEqual(sent, ["+1|hi"]);
});

test("getChannel defaults to fake", async () => {
  delete process.env.MELA_CALLS; delete process.env.MELA_TEXT;
  const got: string[] = [];
  const ch = getChannel(async (_id, t) => { got.push(t); }, store);
  await ch.callVendor("e", "venue-casa-verde", script);
  await tick();
  assert.equal(got[0], store.seed.transcripts.vendors["venue-casa-verde"]);
});

test("ensureDisclosure", () => {
  assert.equal(ensureDisclosure(script).opening, `${DISCLOSURE} Hello`);
  const ok = { ...script, opening: `${DISCLOSURE} Hello` };
  assert.equal(ensureDisclosure(ok).opening, ok.opening);
});
