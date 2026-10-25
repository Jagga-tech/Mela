// The payment gate finance code calls before any deposit to a vendor.
// ok only when the latest CRS result is checked, `clear`, and at most 7 days old.

import { getRisk, isFresh } from "./store";

export async function vendorRiskGate(vendorId: string, now = Date.now()): Promise<{ ok: true } | { ok: false; reason: string }> {
  const risk = getRisk(vendorId);
  if (!risk) return { ok: false, reason: "This vendor hasn't been checked with CRS yet. Run the vendor risk check before paying." };
  if (!isFresh(risk, now)) return { ok: false, reason: `The CRS check from ${risk.checkedAt.slice(0, 10)} is more than 7 days old. Run it again before paying.` };
  if (risk.status !== "checked" || risk.level === null) {
    return { ok: false, reason: `The CRS check didn't finish, so this vendor isn't cleared. ${risk.notCheckedReason ?? ""}`.trim() };
  }
  if (risk.level === "block") {
    const why = risk.reasons.filter((r) => r.severity === "block").map((r) => r.text).join(" ");
    return { ok: false, reason: `CRS check blocks payment to this vendor. ${why}`.trim() };
  }
  if (risk.level === "review") {
    const why = risk.reasons.filter((r) => r.severity === "review").map((r) => r.text).join(" ");
    return { ok: false, reason: `CRS check needs a person's review before paying. ${why}`.trim() };
  }
  return { ok: true };
}
