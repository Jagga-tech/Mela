import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApifyRunError, discoverVendors, toVendors, type DiscoverVendorsOptions, type PlacesItem, type RunPlacesActor } from "../../src/lib/research/apify";
import { memoryCache } from "../../src/lib/research/cache";
import { ResearchSource, Vendor } from "../../src/lib/research/contract";
import { recorder } from "./helpers";

const ITEMS: PlacesItem[] = [
  {
    title: "Taquería Catering Co",
    categoryName: "Caterer",
    address: "123 Mission St, San Francisco, CA",
    phone: "(415) 555-0100",
    website: "https://taqueria-catering.example",
    url: "https://www.google.com/maps/place/?q=place_id:abc",
    placeId: "abc",
    totalScore: 4.7,
    reviewsCount: 212,
  },
  { title: "Closed Florist", url: "https://www.google.com/maps/place/?q=place_id:def", placeId: "def", permanentlyClosed: true },
  { title: "No Link Bakery" },
  { title: "Taquería Catering Co", url: "https://www.google.com/maps/place/?q=place_id:abc", placeId: "abc" },
  { title: "Bad URL Cakes", website: "javascript:alert(1)", url: "https://www.google.com/maps/place/?q=place_id:ghi", placeId: "ghi" },
];

function fakeRun(...results: Array<() => Promise<PlacesItem[]>>) {
  const inputs: Array<Record<string, unknown>> = [];
  const run: RunPlacesActor = async (input) => {
    inputs.push(input);
    return results[Math.min(inputs.length, results.length) - 1]!();
  };
  return { run, inputs };
}

const opts = (run: RunPlacesActor, extra: DiscoverVendorsOptions = {}): DiscoverVendorsOptions => ({
  softTimeoutMs: 20,
  hardTimeoutMs: 120,
  retryDelayMs: 0,
  run,
  ...extra,
});

describe("toVendors", () => {
  it("normalizes, skips closed/unlinked items, dedupes, and drops non-http links", () => {
    const vendors = toVendors(ITEMS, "src-1");
    assert.deepEqual(vendors.map((v) => v.name), ["Taquería Catering Co", "Bad URL Cakes"]);
    assert.deepEqual(vendors[0], {
      id: "gplace:abc",
      name: "Taquería Catering Co",
      category: "Caterer",
      website: "https://taqueria-catering.example/",
      mapsUrl: "https://www.google.com/maps/place/?q=place_id:abc",
      address: "123 Mission St, San Francisco, CA",
      phone: "(415) 555-0100",
      rating: 4.7,
      reviewsCount: 212,
      sourceId: "src-1",
    });
    assert.equal(vendors[1]!.website, undefined);
    for (const v of vendors) Vendor.parse(v);
  });
});

describe("discoverVendors", () => {
  it("searching → found, provider apify, ~10 places in SF", async () => {
    const rec = recorder();
    const { run, inputs } = fakeRun(async () => ITEMS);
    const { source, vendors } = await discoverVendors("quinceañera caterer", rec.onStatus, opts(run));
    assert.deepEqual(rec.statuses(), ["searching", "found"]);
    assert.equal(source.provider, "apify");
    assert.equal(vendors.length, 2);
    assert.equal(vendors[0]!.sourceId, source.id);
    assert.equal(inputs[0]!.maxCrawledPlacesPerSearch, 10);
    assert.equal(inputs[0]!.locationQuery, "San Francisco, CA");
    ResearchSource.parse(source);
  });

  it("no usable places ends empty", async () => {
    const { run } = fakeRun(async () => [{ title: "No Link Bakery" }]);
    const { source } = await discoverVendors("x", recorder().onStatus, opts(run));
    assert.equal(source.status, "empty");
  });

  it("a timed-out run is retried once; a bad token is not", async () => {
    const timedOut = fakeRun(async () => {
      throw new ApifyRunError("TIMED-OUT");
    });
    const a = await discoverVendors("x", recorder().onStatus, opts(timedOut.run));
    assert.equal(a.source.status, "error");
    assert.equal(timedOut.inputs.length, 2);

    const badToken = fakeRun(async () => {
      throw Object.assign(new Error("User was not found or authentication token is not valid"), { statusCode: 401 });
    });
    const b = await discoverVendors("x", recorder().onStatus, opts(badToken.run));
    assert.equal(b.source.status, "error");
    assert.match(b.source.error!, /token/);
    assert.equal(badToken.inputs.length, 1);
  });

  it("out of credit shows as blocked", async () => {
    const { run } = fakeRun(async () => {
      throw Object.assign(new Error("payment required"), { statusCode: 402 });
    });
    const { source } = await discoverVendors("x", recorder().onStatus, opts(run));
    assert.equal(source.status, "blocked");
  });

  it("a cached result points its vendors at the new source row", async () => {
    const cache = memoryCache();
    const { run, inputs } = fakeRun(async () => ITEMS);
    await discoverVendors("caterer", recorder().onStatus, opts(run, { cache }));
    const second = await discoverVendors("caterer", recorder().onStatus, opts(run, { cache }));
    assert.equal(inputs.length, 1);
    assert.equal(second.source.fromCache, true);
    assert.ok(second.vendors.every((v) => v.sourceId === second.source.id));
  });
});
