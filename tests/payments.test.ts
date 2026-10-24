import { test } from "node:test"; import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
import { fileStore } from "@/lib/store"; import { payVendor } from "@/lib/payments"; import { simulatedVisa } from "@/integrations/visa";
const s = fileStore(join(mkdtempSync(join(tmpdir(), "mela-")), "store.json"));
const now = new Date();
const fresh = async () => { const e = await s.createEvent("+15551234567"); return { e, v: e.mandate!.vendorIds[0] }; };

test("happy path then duplicate", async () => {
  const { e, v } = await fresh();
  const r = await payVendor(e, s, simulatedVisa(), v, 50000, now);
  assert.ok(r.ok); if (!r.ok) return;
  assert.equal(r.payment.status, "succeeded"); assert.equal(r.payment.simulated, true);
  assert.ok(r.payment.ref?.startsWith("SIM-")); assert.equal(e.mandate!.spentCents, 50000); assert.equal(e.payments.length, 1);
  const d = await payVendor(e, s, simulatedVisa(), v, 50000, now);
  assert.deepEqual(d, { ok: false, refusal: "duplicate" }); assert.equal(e.payments.length, 1);
});
test("over cap, unknown amount, vendor outside mandate", async () => {
  const { e, v } = await fresh();
  assert.deepEqual(await payVendor(e, s, simulatedVisa(), v, e.mandate!.capCents + 1, now), { ok: false, refusal: "over_cap" });
  assert.deepEqual(await payVendor(e, s, simulatedVisa(), v, null, now), { ok: false, refusal: "amount_unknown" });
  assert.deepEqual(await payVendor(e, s, simulatedVisa(), "nope", 100, now), { ok: false, refusal: "vendor_not_in_mandate" });
  assert.equal(e.payments.length, 0);
});
test("mandate state refusals", async () => {
  const { e, v } = await fresh();
  const m = e.mandate!;
  e.mandate = null; assert.deepEqual(await payVendor(e, s, simulatedVisa(), v, 100, now), { ok: false, refusal: "no_mandate" });
  e.mandate = { ...m, status: "paused" }; assert.deepEqual(await payVendor(e, s, simulatedVisa(), v, 100, now), { ok: false, refusal: "mandate_not_approved" });
  e.mandate = { ...m, expiresAt: new Date(now.getTime() - 1000).toISOString() };
  assert.deepEqual(await payVendor(e, s, simulatedVisa(), v, 100, now), { ok: false, refusal: "mandate_expired" });
});
test("adapter failure leaves payment unknown, spend unchanged", async () => {
  const { e, v } = await fresh();
  const r = await payVendor(e, s, { pay: async () => { throw new Error("timeout"); } }, v, 100, now);
  assert.ok(r.ok); if (!r.ok) return;
  assert.equal(r.payment.status, "unknown"); assert.equal(e.mandate!.spentCents, 0);
  assert.ok(e.audit.some(a => a.action === "payment_unknown"));
});
