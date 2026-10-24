import { test } from "node:test";
import assert from "node:assert/strict";
import { approveCallPlan, buildCallPlan, buildOutcome, checkCallGate, consumeApproval, editCallPlan } from "../src/mela/domain/calls";
import { demoAdapter } from "../src/mela/adapters/demo";
import * as fx from "../src/mela/fixtures/oakland-baby-shower";
import { demoBrief } from "./mela-helpers";

const venue = fx.vendors[0];
const plan = () => buildCallPlan({ brief: demoBrief(), vendor: venue, phoneNumber: fx.scenario.rolePlay.phone, numberSource: { label: "role-play" }, rolePlay: true });

test("a call plan needs a confirmed brief and never shares the budget", () => {
  assert.throws(() => buildCallPlan({ brief: { ...demoBrief(), confirmedAt: null }, vendor: venue, phoneNumber: "1", numberSource: { label: "x" }, rolePlay: true }));
  const p = plan();
  assert.ok(!p.sharedDetails.some((d) => /budget/i.test(d.label) || d.value.includes("2,000")));
  assert.ok(p.privateDetails.some((d) => /budget/i.test(d)));
  assert.match(p.disclosure, /AI assistant/);
});

test("approval binds plan version, script hash, number, vendor and disclosures", () => {
  const p = plan();
  const a = approveCallPlan(p, "host");
  assert.deepEqual(checkCallGate(a, p), { ok: true });
  assert.equal(a.maxAttempts, 1);
  assert.equal(a.phoneNumber, p.phoneNumber);
  assert.equal(a.scriptHash, p.scriptHash);
});

test("no call without approval, or with a stale, tampered, expired or used one", () => {
  const p = plan();
  const a = approveCallPlan(p, "host");
  assert.deepEqual(checkCallGate(null, p), { ok: false, reason: "no_approval" });
  assert.deepEqual(checkCallGate(a, editCallPlan(p, { questions: [...p.questions, "Can we bring a piñata?"] })), { ok: false, reason: "stale_version" });
  assert.deepEqual(checkCallGate(a, { ...p, phoneNumber: "+1 510 555 9999" }), { ok: false, reason: "script_changed" });
  assert.deepEqual(checkCallGate({ ...a, phoneNumber: "+1 510 555 9999" }, p), { ok: false, reason: "number_changed" });
  assert.deepEqual(checkCallGate(a, p, new Date(Date.now() + 16 * 60_000)), { ok: false, reason: "expired" });
  assert.deepEqual(checkCallGate(consumeApproval(a), p), { ok: false, reason: "already_used" });
  assert.deepEqual(checkCallGate({ ...a, status: "revoked" }, p), { ok: false, reason: "revoked" });
});

test("preparing a call for a selected vendor does not start one", async () => {
  const svc = demoAdapter();
  let started = 0;
  const startCall = svc.startCall;
  svc.startCall = async (...args) => { started++; return startCall(...args); };
  const p = await svc.prepareCall(demoBrief(), venue);
  assert.equal(p.vendorId, venue.id);
  assert.equal(started, 0);
});

test("demo calls refuse bad approvals, use the role-play line, and are labeled simulated", async () => {
  const svc = demoAdapter();
  const p = await svc.prepareCall(demoBrief(), venue);
  assert.equal(p.phoneNumber, fx.scenario.rolePlay.phone);
  assert.notEqual(p.phoneNumber, venue.contact?.phone);
  const a = await svc.approveCall(p, "host");
  await assert.rejects(svc.startCall(editCallPlan(p, { opening: "changed" }), a), /changed after you approved/);
  const { attempt, approval } = await svc.startCall(p, a);
  assert.equal(attempt.mode, "simulated");
  assert.equal(attempt.origin.mode, "demo");
  await assert.rejects(svc.startCall(p, approval), /already used/);
  const done = await svc.getCall({ ...attempt, startedAt: new Date(Date.now() - 60_000).toISOString() }, p);
  assert.equal(done.attempt.state, "completed");
  assert.equal(done.outcome?.availability, "vendor_said_verbally");
  assert.equal(done.outcome?.price?.priceType, "verbal");
});

test("verbal answers never become written quotes or bookings", () => {
  const p = plan();
  const o = buildOutcome("c1", p, ["Yes, we're available", null], 125000);
  assert.ok(["not_listed", "needs_confirmation", "vendor_said_verbally"].includes(o.availability));
  assert.equal(o.price?.priceType, "verbal");
  assert.equal(o.answers[1].status, "not_answered");
  assert.ok(o.followUps.some((f) => /in writing/i.test(f)));
  assert.equal(buildOutcome("c2", p, ["Sorry, that date is not available"], null).availability, "needs_confirmation");
});
