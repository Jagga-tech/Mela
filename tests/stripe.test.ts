import { test } from "node:test"; import assert from "node:assert/strict";
import { stripePay } from "@/integrations/pay";

const fakeFetch = (status: number, json: unknown, seen: { url?: string; init?: RequestInit } = {}) =>
  (async (url: string | URL | Request, init?: RequestInit) => { seen.url = String(url); seen.init = init; return new Response(JSON.stringify(json), { status }); }) as typeof fetch;

test("stripe adapter sends amount and idempotency key, returns the intent id", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const r = await stripePay("sk_test_x", fakeFetch(200, { id: "pi_123", status: "succeeded" }, seen)).pay({ amountCents: 50000, vendorId: "v1", idempotencyKey: "e1:pay:v1" });
  assert.deepEqual(r, { ref: "pi_123" });
  assert.equal(seen.url, "https://api.stripe.com/v1/payment_intents");
  assert.equal((seen.init!.headers as Record<string, string>)["Idempotency-Key"], "e1:pay:v1");
  const body = seen.init!.body as URLSearchParams;
  assert.equal(body.get("amount"), "50000"); assert.equal(body.get("confirm"), "true");
});
test("stripe adapter throws on error or non-succeeded status, and refuses live keys", async () => {
  await assert.rejects(stripePay("sk_test_x", fakeFetch(402, { error: { message: "card_declined" } })).pay({ amountCents: 1, vendorId: "v", idempotencyKey: "k" }), /card_declined/);
  await assert.rejects(stripePay("sk_test_x", fakeFetch(200, { id: "pi_1", status: "requires_action" })).pay({ amountCents: 1, vendorId: "v", idempotencyKey: "k" }), /requires_action/);
  assert.throws(() => stripePay("sk_live_x"), /test-mode/);
});
