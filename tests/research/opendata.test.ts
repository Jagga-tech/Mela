import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryCache } from "../../src/lib/research/cache";
import { ResearchSource } from "../../src/lib/research/contract";
import { discoverParks, parseParks, type DiscoverParksOptions } from "../../src/lib/research/opendata";
import { recorder } from "./helpers";

// Shape of real rows from data.sf.gov/resource/3nje-yn2u.json (checked 2026-10-24).
const ROWS = [
  { map_park_n: "Dolores Park", gis_fd_pk: "12", x: "-122.4270", y: "37.7596", acres: "15.9" },
  { map_park_n: "Maritime Plaza", gis_fd_pk: "142", x: "-122.3992", y: "37.7956", acres: "2.01" },
  { map_park_n: "", gis_fd_pk: "999" },
];

function fakeFetch(...responses: Array<() => Promise<Response>>) {
  const urls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    urls.push(String(input));
    const next = responses[Math.min(urls.length, responses.length) - 1]!;
    return next();
  }) as typeof fetch;
  return { fn, urls };
}

const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
const opts = (fetchFn: typeof fetch, extra: DiscoverParksOptions = {}): DiscoverParksOptions => ({
  softTimeoutMs: 20,
  hardTimeoutMs: 120,
  retryDelayMs: 0,
  fetchFn,
  ...extra,
});

describe("parseParks", () => {
  it("maps rows, skips rows without a name, and parses numbers", () => {
    const parsed = parseParks(JSON.stringify(ROWS));
    assert.ok("parks" in parsed);
    assert.deepEqual(parsed.parks.map((p) => p.name), ["Dolores Park", "Maritime Plaza"]);
    assert.deepEqual(parsed.parks[0], { id: "sfrpd:12", name: "Dolores Park", lat: 37.7596, lng: -122.427, acres: 15.9 });
  });

  it("reports non-JSON and non-list bodies", () => {
    assert.ok("problem" in parseParks("<html>"));
    assert.ok("problem" in parseParks('{"error": true}'));
  });
});

describe("discoverParks", () => {
  it("fetching → found, provider open_data, with a select/limit query", async () => {
    const rec = recorder();
    const { fn, urls } = fakeFetch(json(ROWS));
    const { source, parks } = await discoverParks(rec.onStatus, opts(fn));

    assert.deepEqual(rec.statuses(), ["fetching", "found"]);
    assert.equal(source.provider, "open_data");
    assert.equal(source.sourceType, "directory_listing");
    assert.ok(source.fetchedAt);
    assert.equal(parks.length, 2);
    assert.match(decodeURIComponent(urls[0]!), /\$select=map_park_n/);
    ResearchSource.parse(source);
  });

  it("an empty list ends empty with a reason", async () => {
    const { fn } = fakeFetch(json([]));
    const { source, parks } = await discoverParks(recorder().onStatus, opts(fn));
    assert.equal(source.status, "empty");
    assert.ok(source.error);
    assert.deepEqual(parks, []);
  });

  it("a 5xx is retried once, then shown as error", async () => {
    const { fn, urls } = fakeFetch(json({}, 503));
    const { source } = await discoverParks(recorder().onStatus, opts(fn));
    assert.equal(source.status, "error");
    assert.equal(source.attempt, 2);
    assert.equal(urls.length, 2);
  });

  it("a 400 is not retried", async () => {
    const { fn, urls } = fakeFetch(json({}, 400));
    const { source } = await discoverParks(recorder().onStatus, opts(fn));
    assert.equal(source.status, "error");
    assert.equal(urls.length, 1);
  });

  it("a network failure shows as error with the cause", async () => {
    const { fn } = fakeFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const { source } = await discoverParks(recorder().onStatus, opts(fn));
    assert.equal(source.status, "error");
    assert.match(source.error!, /network error: fetch failed/);
  });

  it("serves a repeat from the cache", async () => {
    const cache = memoryCache();
    const { fn, urls } = fakeFetch(json(ROWS));
    await discoverParks(recorder().onStatus, opts(fn, { cache }));
    const second = await discoverParks(recorder().onStatus, opts(fn, { cache }));
    assert.equal(urls.length, 1);
    assert.equal(second.source.fromCache, true);
    assert.equal(second.parks.length, 2);
  });
});
