import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after as afterAll, describe, it } from "node:test";
import { fileCache, memoryCache } from "../../src/lib/research/cache";
import { newSource, ResearchSource } from "../../src/lib/research/contract";
import { fetchPage, type FetchPageOptions } from "../../src/lib/research/fetchPage";
import { searchOfficialPages } from "../../src/lib/research/search";
import { after, badKeyResponse, pageResponse, recorder, sequence } from "./helpers";

const fast = (request: FetchPageOptions["request"], extra: FetchPageOptions = {}): FetchPageOptions => ({
  zone: "test_zone",
  softTimeoutMs: 20,
  hardTimeoutMs: 120,
  retryDelayMs: 0,
  request,
  ...extra,
});
const page = () => newSource({ url: "https://example.org/venue", provider: "bd_unlocker", sourceType: "venue_site" });

describe("fetchPage with a cache", () => {
  it("first call goes live and stores; second call is a labeled hit with the original fetchedAt", async () => {
    const cache = memoryCache();
    const { request, calls } = sequence(after(1, pageResponse()));

    const first = await fetchPage(page(), recorder().onStatus, fast(request, { cache }));
    assert.equal(first.source.status, "found");
    assert.equal(first.source.fromCache, undefined);

    const rec = recorder();
    const second = await fetchPage(page(), rec.onStatus, fast(request, { cache }));
    assert.equal(calls.length, 1, "the second call never reaches Bright Data");
    assert.deepEqual(rec.statuses(), ["found"]);
    assert.equal(second.source.fromCache, true);
    assert.equal(second.source.attempt, 0);
    assert.equal(second.source.fetchedAt, first.source.fetchedAt, "the age of the data is not hidden");
    assert.equal(second.markdown, first.markdown);
    ResearchSource.parse(second.source);
  });

  it("never stores a failure, so the next call goes live again", async () => {
    const cache = memoryCache();
    const { request, calls } = sequence(after(1, badKeyResponse()), after(1, pageResponse()));

    const first = await fetchPage(page(), recorder().onStatus, fast(request, { cache }));
    assert.equal(first.source.status, "error");
    const second = await fetchPage(page(), recorder().onStatus, fast(request, { cache }));
    assert.equal(second.source.status, "found");
    assert.equal(second.source.fromCache, undefined);
    assert.equal(calls.length, 2);
  });

  it("cache: false always goes live (the ablation setting)", async () => {
    const cache = memoryCache();
    const { request, calls } = sequence(after(1, pageResponse()));
    await fetchPage(page(), recorder().onStatus, fast(request, { cache }));
    await fetchPage(page(), recorder().onStatus, fast(request, { cache: false }));
    assert.equal(calls.length, 2);
  });

  it("an expired entry is a miss", async () => {
    let now = Date.parse("2026-10-24T10:00:00Z");
    const cache = memoryCache(60_000, () => now);
    await cache.set("k", { fetchedAt: "2026-10-24T10:00:00Z", value: "x" });
    assert.ok(await cache.get("k"));
    now += 61_000;
    assert.equal(await cache.get("k"), undefined);
  });

  it("a cache that throws doesn't fail the fetch", async () => {
    const broken = {
      get: async () => {
        throw new Error("disk on fire");
      },
      set: async () => {
        throw new Error("disk on fire");
      },
    };
    const { request } = sequence(after(1, pageResponse()));
    const warn = console.warn;
    console.warn = () => {};
    try {
      const { source } = await fetchPage(page(), recorder().onStatus, fast(request, { cache: broken }));
      assert.equal(source.status, "found");
    } finally {
      console.warn = warn;
    }
  });
});

describe("searchOfficialPages with a cache", () => {
  it("serves the same hits from the cache, keyed by the domain filter too", async () => {
    const cache = memoryCache();
    const serp = JSON.stringify({ organic: [{ link: "https://sfrecpark.org/541/x", title: "Permits", rank: 1 }] });
    const { request, calls } = sequence(async () => ({ ...pageResponse(serp) }));
    const opts = { zone: "serp", softTimeoutMs: 20, hardTimeoutMs: 120, retryDelayMs: 0, request, cache };

    const first = await searchOfficialPages("sf permit", recorder().onStatus, opts);
    const second = await searchOfficialPages("sf permit", recorder().onStatus, opts);
    assert.equal(calls.length, 1);
    assert.equal(second.source.fromCache, true);
    assert.deepEqual(second.hits, first.hits);

    await searchOfficialPages("sf permit", recorder().onStatus, { ...opts, allowedDomains: ["sf.gov"] });
    assert.equal(calls.length, 2, "a different domain filter is a different entry");
  });
});

describe("fileCache", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it("round-trips an entry and survives a new instance", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-cache-"));
    dirs.push(dir);
    await fileCache(dir, Infinity).set("page\nzone\nhttps://x", { fetchedAt: "2026-10-24T10:00:00.000Z", value: "# hi" });
    const entry = await fileCache(dir, Infinity).get<string>("page\nzone\nhttps://x");
    assert.deepEqual(entry, { fetchedAt: "2026-10-24T10:00:00.000Z", value: "# hi" });
    assert.equal((await readdir(dir)).filter((f) => f.endsWith(".tmp")).length, 0, "no temp files left behind");
  });

  it("treats a corrupt file as a miss", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-cache-"));
    dirs.push(dir);
    const cache = fileCache(dir, Infinity);
    await cache.set("k", { fetchedAt: "2026-10-24T10:00:00.000Z", value: 1 });
    const [file] = await readdir(dir);
    await writeFile(path.join(dir, file!), "{not json");
    assert.equal(await cache.get("k"), undefined);
  });
});
