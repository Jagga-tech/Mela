import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { apiAdapter } from "../src/mela/adapters/api";
import { createService, parseLive } from "../src/mela/adapters/index";
import { ServiceError } from "../src/mela/service";
import { demoBrief } from "./mela-helpers";

function withFetch(impl: typeof fetch, fn: () => Promise<void>) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => { globalThis.fetch = orig; });
}

test("live capabilities are opt-in per capability; default is all demo", () => {
  assert.deepEqual(Object.values(parseLive(undefined)), [false, false, false, false, false]);
  assert.equal(parseLive("intake, research").research, true);
  assert.equal(parseLive("intake").calls, false);
  assert.equal(createService("").live.intake, false);
});

test("a missing backend endpoint is 'not connected', not a fixture fallback", () =>
  withFetch(async () => new Response(JSON.stringify({ error: "nope" }), { status: 404 }), async () => {
    await assert.rejects(apiAdapter().startResearch(demoBrief()), (e: unknown) => e instanceof ServiceError && e.kind === "not_connected");
  }));

test("network failures and bad shapes are normalized", async () => {
  await withFetch(async () => { throw new TypeError("fetch failed"); }, async () => {
    await assert.rejects(apiAdapter().intake({ text: "hi", brief: null }), (e: unknown) => e instanceof ServiceError && e.kind === "network");
  });
  await withFetch(async () => new Response(JSON.stringify({ brief: 1 }), { status: 200 }), async () => {
    await assert.rejects(apiAdapter().intake({ text: "hi", brief: null }), (e: unknown) => e instanceof ServiceError && e.kind === "invalid_response");
  });
  await withFetch(async () => new Response(JSON.stringify({ error: "Approval is stale" }), { status: 409 }), async () => {
    await assert.rejects(apiAdapter().getCall({ id: "c" } as never, {} as never), (e: unknown) => e instanceof ServiceError && e.kind === "refused" && /stale/.test(e.message));
  });
});

// Client code must only read NEXT_PUBLIC_ env vars; secrets live in route handlers and server-only modules.
test("no secrets are read by client-side modules", () => {
  const files: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((f) => { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(p)) files.push(p); });
  walk("src/mela");
  walk("src/app");
  const client = files.filter((f) => !f.includes("/api/") && !readFileSync(f, "utf8").includes('throw new Error("server only")'));
  for (const f of client) {
    const src = readFileSync(f, "utf8");
    const envs = [...src.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
    assert.deepEqual(envs.filter((e) => !e.startsWith("NEXT_PUBLIC_")), [], f);
    assert.doesNotMatch(src, /sk-ant-|sk_car_|sk_test_|sk_live_/, f);
  }
});
