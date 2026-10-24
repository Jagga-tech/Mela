import { test } from "node:test";
import assert from "node:assert/strict";
import { createApproval, parseReply, applyReply, APPROVAL_TTL_MS } from "../src/lib/approvals";
import type { Event } from "../src/lib/types";

const mkEvent = (): Event => ({ id: "e1", hostPhone: "+1 (555) 010-0000", status: "draft", brief: null, missing: [],
  shortlist: [], calls: [], quotes: [], approvals: [], mandate: null, payments: [], messages: [], humanTasks: [],
  research: [], audit: [], createdAt: "", updatedAt: "" });
const t0 = new Date("2026-10-24T12:00:00Z");
const later = (min: number) => new Date(t0.getTime() + min * 60000);

test("createApproval gives distinct codes and a 30 min TTL", () => {
  const e = mkEvent();
  const a = createApproval(e, "plan", "s", t0);
  const b = createApproval(e, "payment", "s", t0);
  assert.match(a.code, /^\d{4}$/);
  assert.notEqual(a.code, b.code);
  assert.equal(a.status, "pending");
  assert.equal(b.status, "pending");
  assert.equal(new Date(a.expiresAt).getTime() - new Date(a.createdAt).getTime(), APPROVAL_TTL_MS);
  assert.equal(e.approvals.length, 2);
});

test("parseReply", () => {
  assert.deepEqual(parseReply("yes 4821."), { verb: "YES", code: "4821" });
  assert.deepEqual(parseReply("Yes, 4821"), { verb: "YES", code: "4821" });
  assert.equal(parseReply("ok 4821").verb, null);
  assert.equal(parseReply("YES").code, null);
});

test("applyReply outcomes", () => {
  const e = mkEvent();
  const a = createApproval(e, "plan", "s", t0);
  const host = "15550100000";
  assert.equal(applyReply(e, "+19999999999", `YES ${a.code}`, later(1)).outcome, "wrong_sender");
  assert.equal(a.status, "pending");
  assert.equal(applyReply(e, host, "YES", later(1)).outcome, "no_code");
  assert.equal(applyReply(e, host, "YES 0000", later(1)).outcome, "unknown_code");
  assert.equal(applyReply(e, host, `YES ${a.code}`, later(31)).outcome, "expired");
  assert.equal(a.status, "expired");

  const b = createApproval(e, "plan", "s", t0);
  const r = applyReply(e, host, `YES ${b.code}`, later(5));
  assert.equal(r.outcome, "approved");
  assert.ok(b.answeredFrom);
  assert.equal(applyReply(e, host, `YES ${b.code}`, later(6)).outcome, "already_answered");

  const c = createApproval(e, "plan", "s", t0);
  assert.equal(applyReply(e, host, `NO ${c.code}`, later(2)).outcome, "declined");
});
