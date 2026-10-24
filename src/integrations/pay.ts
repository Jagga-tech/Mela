export type PayAdapter = { pay(args: { amountCents: number; vendorId: string; idempotencyKey: string }): Promise<{ ref: string }> };

// Stripe test mode: one PaymentIntent per vendor deposit, charged to Stripe's Visa test card.
// Our idempotency key is passed straight through, so a retry can never double-charge.
export function stripePay(secretKey: string, fetchImpl: typeof fetch = fetch): PayAdapter {
  if (!/^(sk|rk)_test_/.test(secretKey)) throw new Error("STRIPE_SECRET_KEY must be a test-mode key (sk_test_... or rk_test_...)");
  return {
    async pay({ amountCents, vendorId, idempotencyKey }) {
      const body = new URLSearchParams({
        amount: String(amountCents), currency: "usd", confirm: "true", payment_method: "pm_card_visa",
        "payment_method_types[]": "card", description: `Mela deposit: ${vendorId}`,
        "metadata[vendorId]": vendorId, "metadata[idempotencyKey]": idempotencyKey,
      });
      const res = await fetchImpl("https://api.stripe.com/v1/payment_intents", {
        method: "POST", body, signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${secretKey}`, "Idempotency-Key": idempotencyKey, "Content-Type": "application/x-www-form-urlencoded" },
      });
      const j = await res.json() as { id?: string; status?: string; error?: { message?: string } };
      if (!res.ok || j.status !== "succeeded") throw new Error(`stripe ${res.status} ${j.error?.message ?? j.status ?? ""}`.trim());
      return { ref: j.id! };
    },
  };
}

export function getPayAdapter(): PayAdapter {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is required (test-mode key)");
  return stripePay(process.env.STRIPE_SECRET_KEY);
}
