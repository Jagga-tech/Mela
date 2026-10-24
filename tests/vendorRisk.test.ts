import { test } from "node:test"; import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
import type { CrsClient } from "../src/integrations/crs";

// Env must be set before the store module is first loaded, so app modules are imported dynamically.
process.env.MELA_STORE = join(mkdtempSync(join(tmpdir(), "mela-vr-")), "store.json");
delete process.env.CRS_USERNAME; delete process.env.CRS_PASSWORD;
const load = async () => ({ ...(await import("@/lib/vendorRisk")), ...(await import("@/lib/store")) });
const now = new Date();

test("no CRS credentials: review, audited, not cached", async () => {
  const { ensureVendorRisk, store } = await load();
  const e = await store.createEvent("+15551230000"); const v = (await store.getVendor("venue-casa-verde"))!;
  const r = await ensureVendorRisk(e, v, now);
  assert.equal(r.level, "review"); assert.deepEqual(r.reasons, ["CRS not configured"]);
  assert.equal(await store.getVendorRisk(v.id), null);
  assert.equal(e.audit.at(-1)?.detail, "venue-casa-verde review: CRS not configured");
});

test("a failed reverse lookup is not cached; both calls ran is cached and reused", async () => {
  const { ensureVendorRisk, store } = await load();
  const e = await store.createEvent("+15551230001"); const v = (await store.getVendor("cater-la-mesa"))!;
  const ff = async () => ({ risk: { score: 10, phone: { status: "active" }, postal: { last_name_match: "yes" } } });
  const down: CrsClient = { fraudFinder: ff, reversePhone: async () => { throw new Error("timeout"); } };
  assert.deepEqual((await ensureVendorRisk(e, v, now, down)).reasons, ["phone lookup unavailable"]);
  assert.equal(await store.getVendorRisk(v.id), null);
  const up: CrsClient = { fraudFinder: ff, reversePhone: async () => ({ success: true, data: { records: [{ firstName: "MARGARET", lastName: "OKAFOR" }] } }) };
  assert.equal((await ensureVendorRisk(e, v, now, up)).level, "clear");
  assert.equal((await store.getVendorRisk(v.id))?.level, "clear");
  assert.equal((await ensureVendorRisk(e, v, now, down)).level, "clear"); // fresh stored result, no new call
});
