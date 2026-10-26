export type PayArgs = { amountCents: number; vendorId: string; vendorName: string; idempotencyKey: string };
export type PayAdapter = {
  pay(args: PayArgs): Promise<{ ref: string }>;
  // a one-time Stripe onboarding URL to text the vendor, or null when the vendor can already receive deposits
  onboardingLink?(vendorId: string, vendorName: string): Promise<string | null>;
};

export class StripeKeyRefused extends Error {
  override name = "StripeKeyRefused";
}

/** Mela only ever talks to Stripe in test mode. A live key is named explicitly so the refusal is unmistakable. */
export function assertTestModeKey(secretKey: string): void {
  if (/^(sk|rk)_live_/.test(secretKey)) throw new StripeKeyRefused("Refusing a live Stripe key: Mela only uses test-mode keys (sk_test_... or rk_test_...), so no real money can move.");
  if (!/^(sk|rk)_test_/.test(secretKey)) throw new StripeKeyRefused("STRIPE_SECRET_KEY must be a test-mode key (sk_test_... or rk_test_...).");
}

// Stripe test mode: one PaymentIntent per vendor deposit, charged to Stripe's Visa test card and
// routed to the vendor's connected account, which the agent creates on first payment and reuses after.
// Our idempotency key is passed straight through, so a retry can never double-charge.
type StripeFetch = (path: string, init?: { method?: "POST"; body?: URLSearchParams; headers?: Record<string, string> }) => Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

function stripeApi(secretKey: string, fetchImpl: typeof fetch): StripeFetch {
  return async (path, init = {}) => {
    const res = await fetchImpl(`https://api.stripe.com/v1/${path}`, { ...init, signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded", ...init.headers } });
    const j = await res.json() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!res.ok) throw new Error(`stripe ${res.status} ${j.error?.message ?? ""}`.trim());
    return j;
  };
}

// STRIPE_ACCT_<vendorId> overrides (a hand-made account); otherwise find by metadata or create an Express
// account the vendor finishes from a texted link, so they see deposits arrive in the Stripe Express app.
// ponytail: lists the first 100 accounts; fine for 3 vendors, switch to a stored id if the roster grows.
const accountCache = new Map<string, string>();
export async function ensureVendorAccount(api: StripeFetch, vendorId: string, vendorName: string): Promise<string> {
  const env = process.env[`STRIPE_ACCT_${vendorId}`]; if (env) return env;
  const cached = accountCache.get(vendorId); if (cached) return cached;
  const list = await api("accounts?limit=100");
  let acct = (list.data as { id: string; type: string; metadata?: { vendorId?: string } }[]).find(a => a.type === "express" && a.metadata?.vendorId === vendorId)?.id;
  if (!acct) {
    // payouts manual so the balance stays visible in the vendor's Express dashboard
    acct = (await api("accounts", { method: "POST", body: new URLSearchParams({
      type: "express", country: "US", "capabilities[transfers][requested]": "true", business_type: "individual",
      "business_profile[name]": vendorName, "business_profile[mcc]": "7299", "business_profile[product_description]": "Event vendor (Mela demo)",
      "settings[payouts][schedule][interval]": "manual", "metadata[vendorId]": vendorId,
    }) })).id as string;
  }
  accountCache.set(vendorId, acct);
  return acct;
}

const EXPRESS_LOGIN = "https://connect.stripe.com/express_login"; // ponytail: return/refresh land on Express login; a stale link just needs a new text

export function stripePay(secretKey: string, fetchImpl: typeof fetch = fetch): PayAdapter {
  assertTestModeKey(secretKey);
  const api = stripeApi(secretKey, fetchImpl);
  return {
    async onboardingLink(vendorId, vendorName) {
      const acct = await ensureVendorAccount(api, vendorId, vendorName);
      if ((await api(`accounts/${acct}`)).capabilities?.transfers === "active") return null;
      const link = await api("account_links", { method: "POST", body: new URLSearchParams({ account: acct, type: "account_onboarding", refresh_url: EXPRESS_LOGIN, return_url: EXPRESS_LOGIN }) });
      return link.url as string; // single use, expires in 5 minutes
    },
    async pay({ amountCents, vendorId, vendorName, idempotencyKey }) {
      const destination = await ensureVendorAccount(api, vendorId, vendorName);
      const body = new URLSearchParams({
        amount: String(amountCents), currency: "usd", confirm: "true", payment_method: "pm_card_visa",
        "payment_method_types[]": "card", description: `Mela deposit: ${vendorId}`, "transfer_data[destination]": destination,
        "metadata[vendorId]": vendorId, "metadata[idempotencyKey]": idempotencyKey,
      });
      const j = await api("payment_intents", { method: "POST", body, headers: { "Idempotency-Key": idempotencyKey } });
      if (j.status !== "succeeded") throw new Error(`stripe intent ${j.status}`);
      return { ref: j.id as string };
    },
  };
}

export type TestChargeArgs = { amountCents: number; idempotencyKey: string; description: string; metadata: Record<string, string> };
export type TestChargeResult =
  | { ok: true; paymentIntentId: string }
  | { ok: false; outcome: "failed" | "unknown"; message: string };
export type TestCharge = (args: TestChargeArgs) => Promise<TestChargeResult>;

// A single test-mode PaymentIntent on the platform account, paid with Stripe's Visa test card. No Connect
// account is created: the finance vendors are real businesses found on the public web, and Mela must not open
// Stripe accounts in their name. Never throws for Stripe outcomes; "unknown" means the result isn't clear and a
// retry with the same idempotency key is safe (Stripe replays the first result instead of charging twice).
export function stripeTestCharge(secretKey: string, fetchImpl: typeof fetch = fetch): TestCharge {
  assertTestModeKey(secretKey);
  return async ({ amountCents, idempotencyKey, description, metadata }) => {
    if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, outcome: "failed", message: "The amount must be a positive whole number of cents." };
    const body = new URLSearchParams({
      amount: String(amountCents), currency: "usd", confirm: "true", payment_method: "pm_card_visa", "payment_method_types[]": "card", description,
    });
    for (const [k, v] of Object.entries(metadata)) body.set(`metadata[${k}]`, v);
    let res: Response;
    try {
      res = await fetchImpl("https://api.stripe.com/v1/payment_intents", {
        method: "POST", body, signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": idempotencyKey },
      });
    } catch (err) {
      const why = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "couldn't be reached";
      return { ok: false, outcome: "unknown", message: `Stripe ${why}, so the result is unknown. Retrying is safe: the same idempotency key is reused.` };
    }
    const j = (await res.json().catch(() => null)) as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!res.ok) {
      const msg = j?.error?.message ? String(j.error.message) : `HTTP ${res.status}`;
      const unclear = res.status === 409 || res.status === 429 || res.status >= 500;
      return { ok: false, outcome: unclear ? "unknown" : "failed", message: `Stripe ${res.status}: ${msg}` };
    }
    if (!j || typeof j.id !== "string") return { ok: false, outcome: "unknown", message: "Stripe answered without a payment id." };
    if (j.livemode !== false) return { ok: false, outcome: "failed", message: `Stripe reported livemode=${String(j.livemode)} for ${j.id}; Mela only records test-mode payments.` };
    if (j.status !== "succeeded") return { ok: false, outcome: "failed", message: `Stripe test payment ${j.id} is ${String(j.status)}, not succeeded.` };
    return { ok: true, paymentIntentId: j.id };
  };
}

// The agent flow pays only in Stripe test mode; without a key it refuses rather than pretending.
export function getPayAdapter(): PayAdapter {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is required (test-mode key)");
  return stripePay(process.env.STRIPE_SECRET_KEY);
}
