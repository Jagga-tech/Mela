import "server-only";
import { CrsClient } from "./client";
import { getCrsConfig } from "./config";
import { checkVendorRisk } from "./service";
import type { BusinessIdentity } from "./checks";

// Server entry point for the CRS vendor risk check. Route handlers and finance code import from here.

export { vendorRiskGate } from "./gate";
export { getRisk, isFresh } from "./store";
export { CrsConfigError, getCrsConfig } from "./config";
export type { BusinessIdentity } from "./checks";

const g = globalThis as typeof globalThis & { __melaCrsClient?: { key: string; client: CrsClient } };

/** One client per process so the bearer token is reused (CRS: log in once, reuse the token). */
function client(): { client: CrsClient; ofac: ReturnType<typeof getCrsConfig>["ofac"] } {
  const cfg = getCrsConfig();
  const key = `${cfg.baseUrl}|${cfg.username}|${cfg.password}`; // in memory only, never logged
  if (!g.__melaCrsClient || g.__melaCrsClient.key !== key) {
    g.__melaCrsClient = { key, client: new CrsClient({ baseUrl: cfg.baseUrl, username: cfg.username, password: cfg.password }) };
  }
  return { client: g.__melaCrsClient.client, ofac: cfg.ofac };
}

/** Throws CrsConfigError when CRS_USERNAME / CRS_PASSWORD are missing. */
export function runVendorRiskCheck(vendorId: string, business: BusinessIdentity) {
  const { client: c, ofac } = client();
  return checkVendorRisk(vendorId, business, { client: c, ofac });
}
