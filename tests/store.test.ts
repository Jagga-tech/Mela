import { test } from "node:test"; import assert from "node:assert/strict";
import { fileStore } from "@/lib/store"; import { mkdtempSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
const s = fileStore(join(mkdtempSync(join(tmpdir(), "mela-")), "store.json"));
test("createEvent copies the seeded mandate with all vendor ids", async () => {
  const e = await s.createEvent("+15551234567");
  assert.equal(e.status, "draft"); assert.equal(e.hostPhone, "+15551234567");
  assert.deepEqual(e.mandate?.vendorIds.sort(), (await s.listVendors()).map(v => v.id).sort());
  assert.equal(e.mandate?.status, "approved");
});
test("saveEvent round-trips and findEventByCallId finds it", async () => {
  const e = await s.createEvent("+15551234567");
  e.calls.push({ id: "call-1", eventId: e.id, kind: "vendor", vendorId: "venue-casa-verde", script: { opening: "", questions: [], closing: "", mustNotAgreeTo: [] }, status: "placed", startedAt: new Date().toISOString() });
  await s.saveEvent(e);
  assert.equal((await s.findEventByCallId("call-1"))?.id, e.id);
});
test("listVendors filters by category; three categories seeded", async () => {
  assert.equal((await s.listVendors("venue")).length, 1);
  assert.deepEqual(new Set((await s.listVendors()).map(v => v.category)), new Set(["venue","catering","decor"]));
});
test("claimIdempotencyKey is true once", async () => {
  assert.equal(await s.claimIdempotencyKey("k1"), true); assert.equal(await s.claimIdempotencyKey("k1"), false);
});
test("findEventByHostPhone matches digits only, most recent wins", async () => {
  const a = await s.createEvent("+1 (555) 999-0000");
  const b = await s.createEvent("+15559990000");
  await s.saveEvent(b);
  assert.equal((await s.findEventByHostPhone("15559990000"))?.id, b.id);
  assert.notEqual(a.id, b.id);
  assert.equal(await s.findEventByHostPhone("+19998887777"), null);
});
