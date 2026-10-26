// End-to-end acceptance run: real Claude agents against the fake phone/text channel.
import "./env";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Event } from "../src/lib/types";

const TEXT = "I'm planning an outdoor quinceañera in San Francisco for about 100 people, step-free access, some vegetarian guests, budget around $12,000, December 6 2026";
const HOST = "+15550009999";

async function main() {
  process.env.MELA_CALLS = "fake";
  process.env.MELA_TEXT = "console";
  process.env.MELA_STORE = join(mkdtempSync(join(tmpdir(), "mela-demo-")), "store.json");
  delete process.env.STRIPE_SECRET_KEY; // simulated payments only
  const { createEvent, answerEvent, onInboundText } = await import("../src/lib/events");
  const { store } = await import("../src/lib/store");

  const waitFor = async (id: string, pred: (e: Event) => boolean, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    let e: Event | null = null;
    for (;;) {
      e = await store.getEvent(id);
      if (e && pred(e)) return e;
      if (Date.now() > deadline) {
        throw new Error(`timeout after ${timeoutMs}ms; status=${e?.status}\naudit tail: ${JSON.stringify(e?.audit.slice(-5).map((a) => `${a.actor}:${a.action}`))}\nhumanTasks: ${JSON.stringify(e?.humanTasks)}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  const hostTexts = (e: Event) => e.messages.filter((m) => m.to === HOST && m.direction === "out").length;

  const { id, missing: first } = await createEvent(TEXT, HOST, "Priya Sharma");
  const missing = first.length ? (await answerEvent(id, "December 6 2026")).missing : first;
  assert.equal(missing.length, 0, "intake still missing: " + JSON.stringify(missing));

  let e = await waitFor(id, (x) => x.status === "awaiting_approval", 240_000);
  const code = e.approvals.find((a) => a.kind === "plan" && a.status === "pending")?.code;
  assert.ok(code, "no pending plan approval");
  const textsBefore = hostTexts(e);

  assert.equal(await onInboundText("+15550001111", "YES " + code), "wrong_sender");
  assert.equal(await onInboundText(HOST, "YES 0000"), "unknown_code");
  assert.equal((await store.getEvent(id))!.status, "awaiting_approval");

  assert.equal(await onInboundText(HOST, "yes " + code + "."), "approved");
  e = await waitFor(id, (x) => x.status === "done", 60_000);

  assert.equal(e.brief?.guestCount, 110);
  assert.equal(e.quotes.length, 3);
  for (const q of e.quotes) if (q.extract.priceUsd !== null) assert.ok(q.extract.evidence.length > 0, "no evidence for " + q.vendorId);
  assert.equal(e.approvals.length, 1);
  assert.equal(e.approvals[0].status, "approved");
  assert.equal(e.payments.length, 3);
  for (const p of e.payments) { assert.equal(p.status, "succeeded"); assert.equal(p.simulated, true); }
  assert.ok(textsBefore >= 3, `host texts before approval: ${textsBefore}`);
  assert.ok(hostTexts(e) - textsBefore >= 4, `host texts after approval: ${hostTexts(e) - textsBefore}`);
  assert.ok(e.audit.length > 0);
  assert.equal(e.calls.filter((c) => c.kind === "host_final").length, 1);

  console.log("\n=== Mela fake demo: PASS ===");
  console.log(`status: ${e.status}  guests: ${e.brief?.guestCount}`);
  for (const q of e.quotes) console.log(`quote   ${q.vendorId}: price $${q.extract.priceUsd} deposit ${q.extract.depositUsd === null ? "none" : "$" + q.extract.depositUsd} available ${q.extract.available} (${q.extract.evidence.length} evidence)`);
  for (const p of e.payments) console.log(`payment ${p.vendorId}: $${(p.amountCents / 100).toFixed(2)} ${p.status}${p.simulated ? " (simulated)" : ""} ${p.ref}`);
  console.log(`messages: ${e.messages.length} (host: ${textsBefore} before approval, ${hostTexts(e) - textsBefore} after)  calls: ${e.calls.length}  audit: ${e.audit.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
