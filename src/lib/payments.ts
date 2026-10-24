import { randomUUID } from "node:crypto";
import type { Event, Payment, VendorRisk } from "@/lib/types";
import { riskIsFresh } from "@/lib/rules";
import type { Store } from "@/lib/store";
import type { PayAdapter } from "@/integrations/pay";
import { redact } from "@/agents/harness";

export type PayRefusal = "no_mandate" | "mandate_not_approved" | "mandate_expired" | "vendor_not_in_mandate" | "vendor_risk" | "over_cap" | "duplicate" | "amount_unknown";

export async function payVendor(event: Event, store: Store, pay: PayAdapter, vendorId: string, amountCents: number | null, now: Date,
  risk: VendorRisk | null):
  Promise<{ ok: true; payment: Payment } | { ok: false; refusal: PayRefusal }> {
  const audit = (action: string, detail?: string) =>
    event.audit.push({ at: now.toISOString(), actor: "payments", action, detail });
  const m = event.mandate;
  const refuse = async (refusal: PayRefusal) => { audit("payment_refused", refusal); await store.saveEvent(event); return { ok: false, refusal } as const; };
  if (!m) return refuse("no_mandate");
  if (m.status !== "approved") return refuse("mandate_not_approved");
  if (now.getTime() > new Date(m.expiresAt).getTime()) return refuse("mandate_expired");
  if (!m.vendorIds.includes(vendorId)) return refuse("vendor_not_in_mandate");
  if (!riskIsFresh(risk, now) || risk.level !== "clear" || risk.vendorId !== vendorId) return refuse("vendor_risk");
  if (amountCents === null) return refuse("amount_unknown");
  if (m.spentCents + amountCents > m.capCents) return refuse("over_cap");
  const idempotencyKey = `${event.id}:pay:${vendorId}`;
  if (!(await store.claimIdempotencyKey(idempotencyKey))) return refuse("duplicate");

  const payment: Payment = { id: randomUUID(), eventId: event.id, mandateId: m.id, vendorId, amountCents, idempotencyKey,
    status: "pending", createdAt: now.toISOString() };
  event.payments.push(payment);
  await store.saveEvent(event);
  try {
    const r = await pay.pay({ amountCents, vendorId, idempotencyKey });
    payment.status = "succeeded"; payment.ref = r.ref;
    m.spentCents += amountCents;
    audit("payment_succeeded", `${vendorId} ${amountCents} ${r.ref}`);
  } catch (err) {
    // no retry: outcome is unknown, a human reconciles
    payment.status = "unknown";
    audit("payment_unknown", redact(String(err instanceof Error ? err.message : err)));
  }
  await store.saveEvent(event);
  return { ok: true, payment };
}
