import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Event } from "../src/lib/types";

// Env must be set before the store module is first loaded, so everything app-side is imported dynamically.
process.env.MELA_STORE = join(mkdtempSync(join(tmpdir(), "mela-ev-")), "store.json");
process.env.MELA_CALLS = "fake";
process.env.MELA_TEXT = "console";
const load = async () => ({ ...(await import("@/lib/events")), ...(await import("@/lib/store")), ...(await import("@/lib/approvals")) });

const script = { opening: "", questions: [], closing: "", mustNotAgreeTo: [] };

test("markCallEnded ends once, then reports duplicate and keeps the first transcript", async () => {
  const { markCallEnded, store } = await load();
  const e: Event = await store.createEvent("+15550001234");
  e.calls.push({ id: "c1", eventId: e.id, kind: "vendor", vendorId: "venue-casa-verde", script, status: "placed", startedAt: "" });
  assert.equal(markCallEnded(e, "c1", "first"), "ended");
  assert.equal(markCallEnded(e, "c1", "second"), "duplicate");
  assert.equal(e.calls[0].transcript, "first");
  assert.equal(e.calls[0].status, "ended");
  assert.equal(markCallEnded(e, "nope", "x"), "not_found");
});

test("onInboundText from an unknown number is a new request", async () => {
  const { onInboundText } = await load();
  assert.equal(await onInboundText("+19990001111", "hi, I need a party"), "new_request");
});

test("onInboundText with the right code from the wrong number is wrong_sender and changes nothing", async () => {
  const { onInboundText, store, createApproval } = await load();
  const e = await store.createEvent("+15550002222");
  const a = createApproval(e, "plan", "s", new Date());
  await store.saveEvent(e);
  assert.equal(await onInboundText("+15550001111", "YES " + a.code), "wrong_sender");
  const after = await store.getEvent(e.id);
  assert.equal(after?.approvals[0].status, "pending");
  assert.equal(after?.status, "draft");
});

test("tryLock / unlock", async () => {
  const { tryLock, unlock, _resetLocks } = await load();
  _resetLocks();
  assert.equal(tryLock("e1"), true);
  assert.equal(tryLock("e1"), false);
  unlock("e1");
  assert.equal(tryLock("e1"), true);
  _resetLocks();
});
