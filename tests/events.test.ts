import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Event } from "../src/lib/types";

// Env must be set before the store module is first loaded, so everything app-side is imported dynamically.
process.env.MELA_STORE = join(mkdtempSync(join(tmpdir(), "mela-ev-")), "store.json");
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

test("advanceStatus only moves forward; needs_planner allowed before approval", async () => {
  const { advanceStatus, store } = await load();
  const e = await store.createEvent("+15550003333");
  e.status = "awaiting_approval";
  assert.equal(advanceStatus(e, "calling"), false);
  assert.equal(e.status, "awaiting_approval");
  e.status = "calling";
  assert.equal(advanceStatus(e, "awaiting_approval"), true);
  assert.equal(e.status, "awaiting_approval");
  e.status = "calling";
  assert.equal(advanceStatus(e, "needs_planner"), true);
  e.status = "paid";
  assert.equal(advanceStatus(e, "needs_planner"), false);
});

test("quotesToPay picks one available quote per category in shortlist order", async () => {
  const { quotesToPay, store } = await load();
  const vendors = [...(await store.listVendors()),
    { id: "venue-2", name: "V2", category: "venue" as const, phone: "", capacity: 200, priceHintUsd: null, accessibility: [], dietary: [], contactFirstName: "", contactLastName: "", email: null, address: null },
    { id: "cater-2", name: "C2", category: "catering" as const, phone: "", capacity: null, priceHintUsd: null, accessibility: [], dietary: [], contactFirstName: "", contactLastName: "", email: null, address: null }];
  const e = await store.createEvent("+15550004444");
  const item = (vendorId: string) => ({ vendorId, fit: "fit" as const, conflicts: [], unknowns: [], reason: "" });
  const quote = (vendorId: string, available: boolean | null) => ({ vendorId, callId: "c-" + vendorId, createdAt: "",
    extract: { available, priceUsd: 100, depositUsd: null, terms: [], evidence: [], openQuestions: [] } });
  e.shortlist = ["venue-casa-verde", "venue-2", "cater-2", "cater-la-mesa", "decor-flor"].map(item);
  e.quotes = [quote("venue-2", true), quote("venue-casa-verde", true), quote("cater-2", false), quote("cater-la-mesa", true), quote("decor-flor", null)];
  assert.deepEqual(quotesToPay(e, vendors).map((q) => q.vendorId), ["venue-casa-verde", "cater-la-mesa", "decor-flor"]);
});

test("advanceStatus: needs_planner is terminal for automated moves; paying may fall to needs_planner", async () => {
  const { advanceStatus, store } = await load();
  const e = await store.createEvent("+15550005555");
  e.status = "needs_planner";
  assert.equal(advanceStatus(e, "calling"), false);
  assert.equal(advanceStatus(e, "paid"), false);
  assert.equal(e.status, "needs_planner");
  e.status = "paying";
  assert.equal(advanceStatus(e, "needs_planner"), true);
});

test("onInboundText with the same rowId twice: second is duplicate and adds no audit entry", async () => {
  const { onInboundText, store, createApproval } = await load();
  const e = await store.createEvent("+15550006666");
  createApproval(e, "plan", "s", new Date());
  await store.saveEvent(e);
  assert.equal(await onInboundText("+15550006666", "YES 0000", 9001), "unknown_code");
  assert.equal(await onInboundText("+15550006666", "YES 0000", 9001), "duplicate");
  const after = await store.getEvent(e.id);
  assert.equal(after?.audit.filter((a) => a.action === "inbound_reply").length, 1);
});

test("a YES after a decline does not run payments", async () => {
  const { onInboundText, store, createApproval } = await load();
  const e = await store.createEvent("+15550007777");
  const a = createApproval(e, "plan", "s", new Date());
  e.status = "needs_planner";
  await store.saveEvent(e);
  assert.equal(await onInboundText("+15550007777", "YES " + a.code), "approved");
  const after = (await store.getEvent(e.id))!;
  assert.equal(after.status, "needs_planner");
  assert.ok(after.audit.some((x) => x.action === "approval_ignored_status"));
  assert.equal(after.messages.length, 0);
  assert.equal(after.payments.length, 0);
});

test("allPaid only when every planned payment succeeded", async () => {
  const { allPaid } = await load();
  const ok = { status: "succeeded" } as Event["payments"][number];
  assert.equal(allPaid([ok, ok, ok], 3), true);
  assert.equal(allPaid([ok, ok, { ...ok, status: "unknown" }], 3), false);
  assert.equal(allPaid([ok, ok], 3), false);
  assert.equal(allPaid([], 0), false);
});
