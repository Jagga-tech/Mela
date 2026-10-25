// Seam for the vendor-risk check (CRS, built as a separate module). Every Stripe test payment must pass it.
// Until the CRS module is plugged in (configureFinance({ vendorRiskGate }) in deps.ts, or by changing the
// default below), the gate refuses, so no test payment runs against an unchecked vendor.

export type VendorRiskGate = (vendorId: string) => Promise<{ ok: true } | { ok: false; reason: string }>;

export const vendorCheckNotConnected: VendorRiskGate = async () => ({ ok: false, reason: "Vendor check not connected" });
