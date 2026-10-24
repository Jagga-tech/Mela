import { store } from "@/lib/store";
import { riskIsFresh, vendorRisk } from "@/lib/rules";
import { crs } from "@/integrations/crs";
import type { Event, Vendor, VendorRisk } from "@/lib/types";

// Who are we paying: a stored result younger than 7 days, else a fresh CRS check. Only level and reasons are kept.
export async function ensureVendorRisk(event: Event, vendor: Vendor, now: Date, client = crs()): Promise<VendorRisk> {
  const stored = await store.getVendorRisk(vendor.id);
  if (riskIsFresh(stored, now)) return stored;
  const settle = async <T>(p: () => Promise<T>) => { try { return await p(); } catch { return null; } };
  const ff = client && await settle(() => client.fraudFinder(vendor));
  const rev = client && await settle(() => client.reversePhone(vendor));
  const { level, reasons } = client ? vendorRisk(ff, rev, vendor) : { level: "review" as const, reasons: ["CRS not configured"] };
  const risk: VendorRisk = { vendorId: vendor.id, level, reasons, checkedAt: now.toISOString(), source: "crs" };
  // only a check where both calls ran is cached; otherwise the next run tries again instead of waiting 7 days
  if (ff && rev) await store.saveVendorRisk(risk);
  event.audit.push({ at: now.toISOString(), actor: "crs", action: "crs_check", detail: `${vendor.id} ${level}: ${reasons.join("; ")}` });
  return risk;
}
