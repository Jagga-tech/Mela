import { randomBytes } from "node:crypto";

export type PayArgs = { amountCents: number; vendorId: string; vendorName: string; idempotencyKey: string };
export type PayAdapter = {
  pay(args: PayArgs): Promise<{ ref: string; simulated: boolean }>;
  // a one-time Stripe onboarding URL to text the vendor, or null when the vendor can already receive deposits
  onboardingLink?(vendorId: string, vendorName: string): Promise<string | null>;
};

export function simulatedPay(): PayAdapter {
  return { pay: () => new Promise(res => setImmediate(() => res({ ref: "SIM-" + randomBytes(4).toString("hex"), simulated: true }))) };
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
  if (!/^(sk|rk)_test_/.test(secretKey)) throw new Error("STRIPE_SECRET_KEY must be a test-mode key (sk_test_... or rk_test_...)");
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
      return { ref: j.id as string, simulated: false };
    },
  };
}

export function getPayAdapter(): PayAdapter { return process.env.STRIPE_SECRET_KEY ? stripePay(process.env.STRIPE_SECRET_KEY) : simulatedPay(); }
