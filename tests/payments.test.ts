import { test } from "node:test"; import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
import { fileStore } from "@/lib/store"; import { payVendor } from "@/lib/payments"; import type { PayAdapter } from "@/integrations/pay"; import type { VendorRisk } from "@/lib/types";
const s = fileStore(join(mkdtempSync(join(tmpdir(), "mela-")), "store.json"));
const now = new Date();
const testPay = (): PayAdapter => ({ pay: async () => ({ ref: "pi_test" }) });
const fresh = async () => { const e = await s.createEvent("+15551234567"); return { e, v: e.mandate!.vendorIds[0] }; };
const risk = (o: Partial<VendorRisk> = {}): VendorRisk => ({ vendorId: "venue-casa-verde", level: "clear", reasons: [], checkedAt: now.toISOString(), source: "crs", ...o });
const clear = risk();

test("happy path then duplicate", async () => {
  const { e, v } = await fresh();
  const r = await payVendor(e, s, testPay(), v, 50000, now, clear);
  assert.ok(r.ok); if (!r.ok) return;
  assert.equal(r.payment.status, "succeeded");
  assert.equal(r.payment.ref, "pi_test"); assert.equal(e.mandate!.spentCents, 50000); assert.equal(e.payments.length, 1);
  const d = await payVendor(e, s, testPay(), v, 50000, now, clear);
  assert.deepEqual(d, { ok: false, refusal: "duplicate" }); assert.equal(e.payments.length, 1);
});
test("over cap, unknown amount, vendor outside mandate", async () => {
  const { e, v } = await fresh();
  assert.deepEqual(await payVendor(e, s, testPay(), v, e.mandate!.capCents + 1, now, clear), { ok: false, refusal: "over_cap" });
  assert.deepEqual(await payVendor(e, s, testPay(), v, null, now, clear), { ok: false, refusal: "amount_unknown" });
  assert.deepEqual(await payVendor(e, s, testPay(), "nope", 100, now, clear), { ok: false, refusal: "vendor_not_in_mandate" });
  assert.equal(e.payments.length, 0);
});
test("mandate state refusals", async () => {
  const { e, v } = await fresh();
  const m = e.mandate!;
  e.mandate = null; assert.deepEqual(await payVendor(e, s, testPay(), v, 100, now, clear), { ok: false, refusal: "no_mandate" });
  e.mandate = { ...m, status: "paused" }; assert.deepEqual(await payVendor(e, s, testPay(), v, 100, now, clear), { ok: false, refusal: "mandate_not_approved" });
  e.mandate = { ...m, expiresAt: new Date(now.getTime() - 1000).toISOString() };
  assert.deepEqual(await payVendor(e, s, testPay(), v, 100, now, clear), { ok: false, refusal: "mandate_expired" });
});
test("adapter failure leaves payment unknown, spend unchanged", async () => {
  const { e, v } = await fresh();
  const r = await payVendor(e, s, { pay: async () => { throw new Error("timeout"); } }, v, 100, now, clear);
  assert.ok(r.ok); if (!r.ok) return;
  assert.equal(r.payment.status, "unknown"); assert.equal(e.mandate!.spentCents, 0);
  assert.ok(e.audit.some(a => a.action === "payment_unknown"));
});

test("vendor risk must be fresh and clear", async () => {
  const { e, v } = await fresh();
  const refused = { ok: false, refusal: "vendor_risk" };
  assert.deepEqual(await payVendor(e, s, testPay(), v, 100, now, risk({ level: "review" })), refused);
  assert.deepEqual(await payVendor(e, s, testPay(), v, 100, now, risk({ checkedAt: new Date(now.getTime() - 8 * 86400000).toISOString() })), refused);
  assert.deepEqual(await payVendor(e, s, testPay(), v, 100, now, null), refused);
  assert.equal(e.payments.length, 0);
});
test("a clear result for another vendor does not count", async () => {
  const { e, v } = await fresh();
  assert.deepEqual(await payVendor(e, s, testPay(), v, 100, now, risk({ vendorId: "decor-flor" })), { ok: false, refusal: "vendor_risk" });
});

test("open finance exception → finance_hold", async () => {
  const { e, v } = await fresh();
  e.financeExceptions.push({ id: "x", eventId: e.id, vendorId: v, kind: "mismatch", lines: [], explanation: "", approver: "host", status: "open", createdAt: "" });
  assert.deepEqual(await payVendor(e, s, testPay(), v, 100, now, clear), { ok: false, refusal: "finance_hold" });
  e.financeExceptions[0].status = "cleared";
  assert.ok((await payVendor(e, s, testPay(), v, 100, now, clear)).ok);
});
test("balance key differs from deposit key; both succeed", async () => {
  const { e, v } = await fresh();
  const d = await payVendor(e, s, testPay(), v, 50000, now, clear);
  const b = await payVendor(e, s, testPay(), v, 130000, now, clear, "balance");
  assert.ok(d.ok && b.ok); if (!d.ok || !b.ok) return;
  assert.equal(d.payment.idempotencyKey, `${e.id}:pay:${v}`); assert.equal(d.payment.kind, "deposit");
  assert.equal(b.payment.idempotencyKey, `${e.id}:pay:${v}:balance`); assert.equal(b.payment.kind, "balance");
  assert.deepEqual(await payVendor(e, s, testPay(), v, 130000, now, clear, "balance"), { ok: false, refusal: "duplicate" });
});
