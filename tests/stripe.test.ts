import { test } from "node:test"; import assert from "node:assert/strict";
import { stripePay } from "@/integrations/pay";

// routes by path: GET accounts -> list, POST accounts -> created, POST payment_intents -> intent
type Route = { status?: number; json: unknown };
const fakeFetch = (routes: Record<string, Route>, seen: { url: string; init?: RequestInit }[] = []) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    const key = `${init?.method ?? "GET"} ${String(url).split("/v1/")[1].split("?")[0]}`;
    const r = routes[key]; if (!r) throw new Error("unexpected " + key);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as typeof fetch;
const args = { amountCents: 50000, vendorId: "v1", vendorName: "Casa Verde", idempotencyKey: "e1:pay:v1" };

test("creates the vendor account once, then routes the deposit to it", async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const f = fakeFetch({ "GET accounts": { json: { data: [] } }, "POST accounts": { json: { id: "acct_new" } },
    "POST payment_intents": { json: { id: "pi_123", status: "succeeded" } } }, seen);
  const r = await stripePay("sk_test_x", f).pay(args);
  assert.deepEqual(r, { ref: "pi_123", simulated: false });
  const created = seen.find(s => s.url.endsWith("/accounts") && s.init?.method === "POST")!.init!.body as URLSearchParams;
  assert.equal(created.get("metadata[vendorId]"), "v1"); assert.equal(created.get("business_profile[name]"), "Casa Verde");
  const intent = seen.find(s => s.url.endsWith("/payment_intents"))!;
  assert.equal((intent.init!.headers as Record<string, string>)["Idempotency-Key"], "e1:pay:v1");
  const body = intent.init!.body as URLSearchParams;
  assert.equal(body.get("amount"), "50000"); assert.equal(body.get("confirm"), "true"); assert.equal(body.get("transfer_data[destination]"), "acct_new");
  // second payment to the same vendor: cached, no account calls
  seen.length = 0; await stripePay("sk_test_x", f).pay({ ...args, idempotencyKey: "e2:pay:v1" });
  assert.deepEqual(seen.map(s => s.url.split("/v1/")[1]), ["payment_intents"]);
});
test("reuses an existing account found by metadata", async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const f = fakeFetch({ "GET accounts": { json: { data: [{ id: "acct_old", metadata: { vendorId: "v2" } }] } },
    "POST payment_intents": { json: { id: "pi_2", status: "succeeded" } } }, seen);
  await stripePay("sk_test_x", f).pay({ ...args, vendorId: "v2" });
  assert.equal((seen.at(-1)!.init!.body as URLSearchParams).get("transfer_data[destination]"), "acct_old");
});
test("throws on error or non-succeeded status, and refuses live keys", async () => {
  await assert.rejects(stripePay("sk_test_x", fakeFetch({ "GET accounts": { status: 403, json: { error: { message: "signed up for Connect" } } } })).pay({ ...args, vendorId: "v3" }), /Connect/);
  process.env.STRIPE_ACCT_v4 = "acct_env";
  await assert.rejects(stripePay("sk_test_x", fakeFetch({ "POST payment_intents": { status: 402, json: { error: { message: "card_declined" } } } })).pay({ ...args, vendorId: "v4" }), /card_declined/);
  await assert.rejects(stripePay("sk_test_x", fakeFetch({ "POST payment_intents": { json: { id: "pi_1", status: "requires_action" } } })).pay({ ...args, vendorId: "v4" }), /requires_action/);
  assert.throws(() => stripePay("sk_live_x"), /test-mode/);
});
