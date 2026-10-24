import { test } from "node:test"; import assert from "node:assert/strict";
import { crsClient } from "@/integrations/crs";
import type { Vendor } from "@/lib/types";

const vendor: Vendor = { id: "v", name: "V", category: "venue", phone: "+1 (555) 000-0001", capacity: null, priceHintUsd: null,
  accessibility: [], dietary: [], contactFirstName: "Ana", contactLastName: "Verde", email: null, address: null };
const env = { CRS_USERNAME: "u", CRS_PASSWORD: "p" } as unknown as NodeJS.ProcessEnv;
type Call = { url: string; init: RequestInit };
// scripted: each product response in order; login always succeeds with tok1, tok2, ...
const fake = (product: [number, unknown][]) => {
  const calls: Call[] = []; let logins = 0;
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    if (String(url).endsWith("/users/login")) return Response.json({ token: `tok${++logins}`, expires: 3600 });
    const [status, json] = product.shift()!;
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;
  return { f, calls, logins: () => calls.filter((c) => c.url.endsWith("/users/login")) };
};
const ff = { risk: { score: 10 } };

test("crsClient is null without credentials", () => { assert.equal(crsClient({} as unknown as NodeJS.ProcessEnv), null); });

test("logs in lazily, posts fraud-finder with bearer token, caches the token", async () => {
  const { f, calls, logins } = fake([[200, ff], [200, ff]]);
  const c = crsClient(env, f)!;
  assert.equal(calls.length, 0);
  assert.deepEqual(await c.fraudFinder(vendor), ff);
  assert.equal(calls[0].url, "https://api-sandbox.stitchcredit.com/api/users/login");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { username: "u", password: "p" });
  assert.equal(calls[1].url, "https://api-sandbox.stitchcredit.com/api/fraud-finder/fraud-finder");
  assert.equal((calls[1].init.headers as Record<string, string>).Authorization, "Bearer tok1");
  const body = JSON.parse(calls[1].init.body as string);
  assert.equal(body.phoneNumber, "15550000001"); assert.equal(body.firstName, "Ana"); assert.equal(body.lastName, "Verde");
  await c.fraudFinder(vendor);
  assert.equal(logins().length, 1);
});

test("401 re-logs in once and retries; a second 401 throws", async () => {
  const ok = fake([[401, {}], [200, ff]]);
  assert.deepEqual(await crsClient(env, ok.f)!.reversePhone(vendor), ff);
  assert.equal(ok.logins().length, 2); assert.equal(ok.calls.length - 2, 2);
  assert.equal((ok.calls[3].init.headers as Record<string, string>).Authorization, "Bearer tok2");
  const bad = fake([[401, {}], [401, {}]]);
  await assert.rejects(crsClient(env, bad.f)!.reversePhone(vendor), /crs 401/);
});

test("other errors throw with the first message", async () => {
  const { f } = fake([[500, { messages: ["boom"] }]]);
  await assert.rejects(crsClient(env, f)!.fraudFinder(vendor), /crs 500 boom/);
});
