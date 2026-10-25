// Latest CRS result per vendor, in this server process's memory. Kept on
// globalThis so `next dev` hot reloads don't drop it (same as the research job store).
// Stores only the decided VendorRisk (level, cited reasons, matched business name),
// never a raw CRS response.

import type { VendorRisk } from "@/mela/contracts";

const MAX_ENTRIES = 500;

const g = globalThis as typeof globalThis & { __melaVendorRisk?: Map<string, VendorRisk> };
const results = (g.__melaVendorRisk ??= new Map());

export function saveRisk(risk: VendorRisk): void {
  results.delete(risk.vendorId); // re-insert so the newest is last
  results.set(risk.vendorId, risk);
  while (results.size > MAX_ENTRIES) results.delete(results.keys().next().value!);
}

export function getRisk(vendorId: string): VendorRisk | undefined {
  return results.get(vendorId);
}

export function isFresh(risk: VendorRisk, now = Date.now()): boolean {
  const until = Date.parse(risk.freshUntil);
  return Number.isFinite(until) && now <= until;
}

/** Test hook. */
export function clearRiskStore(): void {
  results.clear();
}
