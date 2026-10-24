import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newSource, ResearchSource, isTerminal } from "../../lib/research/contract";
import { fetchPage, type FetchPageOptions } from "../../lib/research/fetchPage";
import { after, badKeyResponse, captchaResponse, pageResponse, recorder, sequence, sleep } from "./helpers";

const source = () =>
  newSource({ url: "https://sfrecpark.org/541/Special-Event-Application-Information", provider: "bd_unlocker", sourceType: "official_city" });

// Tiny timeouts so the suite runs in about a second.
const fast = (request: FetchPageOptions["request"], extra: FetchPageOptions = {}): FetchPageOptions => ({
  zone: "test_zone",
  softTimeoutMs: 20,
  hardTimeoutMs: 120,
  retryDelayMs: 0,
  request,
  ...extra,
});

describe("fetchPage status flow", () => {
  it("fast success: fetching → found, with fetchedAt and markdown", async () => {
    const rec = recorder();
    const { request, calls } = sequence(after(1, pageResponse()));
    const { source: final, markdown } = await fetchPage(source(), rec.onStatus, fast(request));

    assert.deepEqual(rec.statuses(), ["fetching", "found"]);
    assert.equal(final.attempt, 1);
    assert.ok(final.fetchedAt && !Number.isNaN(Date.parse(final.fetchedAt)));
    assert.equal(final.error, undefined);
    assert.ok(markdown?.includes("60 days"));
    assert.equal(calls[0]?.dataFormat, "markdown");
    assert.equal(calls[0]?.zone, "test_zone");
    ResearchSource.parse(final); // matches the shared contract
  });

  it("slow but successful: fetching → slow → found", async () => {
    const rec = recorder();
    const { request } = sequence(after(60, pageResponse()));
    const { source: final } = await fetchPage(source(), rec.onStatus, fast(request));
    assert.deepEqual(rec.statuses(), ["fetching", "slow", "found"]);
    assert.equal(final.attempt, 1);
  });

  it("hard timeout cancels attempt 1, attempt 2 succeeds", async () => {
    const rec = recorder();
    const { request, calls } = sequence(after(5_000, pageResponse()), after(1, pageResponse()));
    const { source: final } = await fetchPage(source(), rec.onStatus, fast(request));

    assert.deepEqual(rec.statuses(), ["fetching", "slow", "fetching", "found"]);
    assert.equal(calls[0]?.signal?.aborted, true, "attempt 1 should be cancelled, not left running");
    assert.match(rec.seen[2]!.error!, /attempt 1 failed .*no response within 0\.1 s.*retrying/);
    assert.equal(rec.seen[2]!.attempt, 2);
    assert.equal(final.attempt, 2);
    assert.equal(final.error, undefined, "a successful retry clears the error");
  });

  it("is bounded even if the request ignores the abort signal", async () => {
    const rec = recorder();
    const neverResolves = () => new Promise<never>(() => {});
    const { request, calls } = sequence(neverResolves);
    const t0 = performance.now();
    const { source: final } = await fetchPage(source(), rec.onStatus, fast(request, { hardTimeoutMs: 60 }));

    assert.deepEqual(rec.statuses(), ["fetching", "slow", "fetching", "slow", "error"]);
    assert.equal(calls.length, 2);
    assert.ok(performance.now() - t0 < 1_000, "two attempts at 60 ms each should finish well under a second");
    assert.match(final.error!, /no response within/);
  });

  it("doesn't retry a bad API key", async () => {
    const rec = recorder();
    const { request, calls } = sequence(after(1, badKeyResponse()));
    const { source: final, markdown } = await fetchPage(source(), rec.onStatus, fast(request));

    assert.deepEqual(rec.statuses(), ["fetching", "error"]);
    assert.equal(calls.length, 1);
    assert.equal(final.fetchedAt, undefined);
    assert.equal(markdown, undefined);
    assert.match(final.error!, /API key/);
  });

  it("retries a CAPTCHA once, then reports blocked (max 2 attempts)", async () => {
    const rec = recorder();
    const { request, calls } = sequence(after(1, captchaResponse()));
    const { source: final } = await fetchPage(source(), rec.onStatus, fast(request));

    assert.deepEqual(rec.statuses(), ["fetching", "fetching", "blocked"]);
    assert.equal(calls.length, 2);
    assert.equal(final.attempt, 2);
    assert.match(final.error!, /CAPTCHA/);
  });

  it("never makes more than 2 attempts, whatever maxAttempts says", async () => {
    const { request, calls } = sequence(after(1, captchaResponse()));
    await fetchPage(source(), () => {}, fast(request, { maxAttempts: 5 }));
    assert.equal(calls.length, 2);
  });

  it("reports an almost-empty page as empty, without retrying", async () => {
    const rec = recorder();
    const { request, calls } = sequence(after(1, pageResponse("   ")));
    const { source: final, markdown } = await fetchPage(source(), rec.onStatus, fast(request));

    assert.deepEqual(rec.statuses(), ["fetching", "empty"]);
    assert.equal(calls.length, 1);
    assert.ok(final.fetchedAt, "we did get a page, so it has a fetch time");
    assert.equal(markdown, undefined);
  });

  it("rejects an invalid URL without calling Bright Data", async () => {
    const rec = recorder();
    const { request, calls } = sequence(after(1, pageResponse()));
    const bad = { ...source(), url: "not a url" };
    const { source: final } = await fetchPage(bad, rec.onStatus, fast(request));

    assert.deepEqual(rec.statuses(), ["error"]);
    assert.equal(calls.length, 0);
    assert.match(final.error!, /invalid URL/);
  });

  it("turns a crash in the request into an error row, without retrying", async () => {
    const rec = recorder();
    const { request, calls } = sequence(async () => {
      throw new Error("boom");
    });
    const { source: final } = await fetchPage(source(), rec.onStatus, fast(request));

    assert.deepEqual(rec.statuses(), ["fetching", "error"]);
    assert.equal(calls.length, 1);
    assert.match(final.error!, /internal error: boom/);
  });
});

describe("fetchPage status updates", () => {
  it("never sends a status after the final one", async () => {
    const rec = recorder();
    // Answer right around the soft timeout, the likeliest moment for a race.
    const { request } = sequence(after(20, pageResponse()));
    const { source: final } = await fetchPage(source(), rec.onStatus, fast(request));
    const countAtReturn = rec.seen.length;
    await sleep(100);

    assert.equal(rec.seen.length, countAtReturn, "no late 'slow' after the result");
    assert.ok(isTerminal(rec.seen.at(-1)!.status));
    assert.deepEqual(rec.seen.at(-1), final, "the last update matches what fetchPage returned");
  });

  it("delivers updates in order even when writes are slow", async () => {
    const order: string[] = [];
    const slowWrite = async (s: ResearchSource) => {
      await sleep(s.status === "fetching" ? 40 : 1); // first write is the slowest
      order.push(s.status);
    };
    const { request } = sequence(after(60, pageResponse()));
    await fetchPage(source(), slowWrite, fast(request));
    assert.deepEqual(order, ["fetching", "slow", "found"]);
  });

  it("keeps researching when a status write fails", async () => {
    const { request } = sequence(after(1, pageResponse()));
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const { source: final } = await fetchPage(
        source(),
        () => {
          throw new Error("database down");
        },
        fast(request),
      );
      assert.equal(final.status, "found");
    } finally {
      console.warn = originalWarn;
    }
  });

  it("sends copies, so a listener can't change the result", async () => {
    const { request } = sequence(after(1, pageResponse()));
    const { source: final } = await fetchPage(
      source(),
      (s) => {
        s.status = "error";
        s.url = "mutated";
      },
      fast(request),
    );
    assert.equal(final.status, "found");
    assert.notEqual(final.url, "mutated");
  });
});
