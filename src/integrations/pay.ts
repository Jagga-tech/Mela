import { randomBytes } from "node:crypto";

export type PayAdapter = { pay(args: { amountCents: number; vendorId: string; idempotencyKey: string }): Promise<{ ref: string; simulated: boolean }> };

export function simulatedPay(): PayAdapter {
  return { pay: () => new Promise(res => setImmediate(() => res({ ref: "SIM-" + randomBytes(4).toString("hex"), simulated: true }))) };
}

// Stripe test mode: one PaymentIntent per vendor deposit, charged to Stripe's Visa test card and
// routed to the vendor's connected account (STRIPE_ACCT_<vendorId>, created by scripts/stripe-vendors.ts).
// Our idempotency key is passed straight through, so a retry can never double-charge.
export const vendorAccount = (vendorId: string) => process.env[`STRIPE_ACCT_${vendorId}`];

export function stripePay(secretKey: string, fetchImpl: typeof fetch = fetch, accountFor = vendorAccount): PayAdapter {
  if (!/^(sk|rk)_test_/.test(secretKey)) throw new Error("STRIPE_SECRET_KEY must be a test-mode key (sk_test_... or rk_test_...)");
  return {
    async pay({ amountCents, vendorId, idempotencyKey }) {
      const destination = accountFor(vendorId);
      // refuse before any call: a charge that never reaches the vendor must not be reported as sent
      if (!destination) throw new Error(`no Stripe account for vendor ${vendorId} (set STRIPE_ACCT_${vendorId})`);
      const body = new URLSearchParams({
        amount: String(amountCents), currency: "usd", confirm: "true", payment_method: "pm_card_visa",
        "payment_method_types[]": "card", description: `Mela deposit: ${vendorId}`, "transfer_data[destination]": destination,
        "metadata[vendorId]": vendorId, "metadata[idempotencyKey]": idempotencyKey,
      });
      const res = await fetchImpl("https://api.stripe.com/v1/payment_intents", {
        method: "POST", body, signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${secretKey}`, "Idempotency-Key": idempotencyKey, "Content-Type": "application/x-www-form-urlencoded" },
      });
      const j = await res.json() as { id?: string; status?: string; error?: { message?: string } };
      if (!res.ok || j.status !== "succeeded") throw new Error(`stripe ${res.status} ${j.error?.message ?? j.status ?? ""}`.trim());
      return { ref: j.id!, simulated: false };
    },
  };
}

export function getPayAdapter(): PayAdapter { return process.env.STRIPE_SECRET_KEY ? stripePay(process.env.STRIPE_SECRET_KEY) : simulatedPay(); }
