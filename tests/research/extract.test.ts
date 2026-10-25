import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryCache } from "../../src/lib/research/cache";
import { extractFacts, MAX_PAGE_CHARS, toCandidates, type ExtractCall } from "../../src/lib/research/extract";

const input = { markdown: "# Venue\nCapacity: 150 guests.", entityName: "Test Venue", fields: ["capacity", "alcohol"] as const };

function fakeCall(result: Awaited<ReturnType<ExtractCall>>) {
  const calls: Array<Parameters<ExtractCall>> = [];
  const call: ExtractCall = async (...args) => {
    calls.push(args);
    return result;
  };
  return { call, calls };
}

describe("toCandidates", () => {
  it("keeps the first answer per field, drops unrequested fields, and maps null to undefined", () => {
    const out = toCandidates(
      {
        facts: [
          { field: "capacity", value: 150, quote: "Capacity: 150 guests." },
          { field: "capacity", value: 999, quote: "nope" },
          { field: "rental_fee", value: 10, quote: "x" },
          { field: "alcohol", value: null, quote: null },
        ],
      },
      ["capacity", "alcohol"],
    );
    assert.deepEqual(out, [
      { field: "capacity", value: 150, quote: "Capacity: 150 guests." },
      { field: "alcohol", value: undefined, quote: undefined },
    ]);
  });
});

describe("extractFacts", () => {
  it("returns candidates from the model call, with the model and timeout passed through", async () => {
    const { call, calls } = fakeCall({ ok: true, output: { facts: [{ field: "capacity", value: 150, quote: "Capacity: 150 guests." }] } });
    const out = await extractFacts(input, { call, model: "test-model", timeoutMs: 1234 });
    assert.deepEqual(out, { ok: true, candidates: [{ field: "capacity", value: 150, quote: "Capacity: 150 guests." }] });
    assert.equal(calls[0]![1].model, "test-model");
    assert.equal(calls[0]![1].timeoutMs, 1234);
  });

  it("passes a failure through as a reason", async () => {
    const { call } = fakeCall({ ok: false, reason: "model declined" });
    assert.deepEqual(await extractFacts(input, { call }), { ok: false, reason: "model declined" });
  });

  it("reports an over-long page instead of truncating it, without calling the model", async () => {
    const { call, calls } = fakeCall({ ok: true, output: { facts: [] } });
    const out = await extractFacts({ ...input, markdown: "x".repeat(MAX_PAGE_CHARS + 1) }, { call });
    assert.equal(out.ok, false);
    assert.match((out as { reason: string }).reason, /too long/);
    assert.equal(calls.length, 0);
  });

  it("no fields means no call", async () => {
    const { call, calls } = fakeCall({ ok: true, output: { facts: [] } });
    assert.deepEqual(await extractFacts({ ...input, fields: [] }, { call }), { ok: true, candidates: [] });
    assert.equal(calls.length, 0);
  });

  it("caches by page text: same page skips the model, a changed page calls it again", async () => {
    const cache = memoryCache();
    const { call, calls } = fakeCall({ ok: true, output: { facts: [{ field: "capacity", value: 150, quote: "Capacity: 150 guests." }] } });
    await extractFacts(input, { call, cache });
    const second = await extractFacts(input, { call, cache });
    assert.equal(calls.length, 1);
    assert.equal(second.ok && second.fromCache, true);

    await extractFacts({ ...input, markdown: `${input.markdown} Updated.` }, { call, cache });
    assert.equal(calls.length, 2);
  });

  it("never caches a failure", async () => {
    const cache = memoryCache();
    const { call, calls } = fakeCall({ ok: false, reason: "LLM rate limited" });
    await extractFacts(input, { call, cache });
    await extractFacts(input, { call, cache });
    assert.equal(calls.length, 2);
  });
});
