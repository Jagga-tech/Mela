import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResearchSnapshot, type EventBrief } from "../../src/mela/contracts";
import { evaluateVendor } from "../../src/mela/domain/match";
import type { RunPlacesActor } from "../../src/lib/research/apify";
import type { BrightDataRequestFn } from "../../src/lib/research/brightdata";
import type { ExtractCall } from "../../src/lib/research/extract";
import { cancelJob, createJob, nameFromTitle, runJob, vendorIdFor, type JobDeps } from "../../src/lib/research/job";
import { toSnapshot, toWebFact } from "../../src/lib/research/snapshot";
import { priceQualifier } from "../../src/lib/research/verify";
import { badKeyResponse, pageResponse, sleep } from "./helpers";

const VENUE_PAGE = `# Lakeside Hall\n\nOur hall seats up to 120 guests. Saturday rental: $1,100. Outside caterers welcome. Call us at (510) 555-0142. ${"Lorem ipsum. ".repeat(10)}`;
const CATERER_PAGE = `# Cocina Rosa\n\nAuthentic Mexican catering. Packages start at $32 per guest. Vegetarian menus available. ${"Lorem ipsum. ".repeat(10)}`;

const serpBody = JSON.stringify({
  organic: [
    { rank: 1, title: "Best venues - Yelp", link: "https://www.yelp.com/list/venues" },
    { rank: 2, title: "Event Rentals | Lakeside Hall", link: "https://lakesidehall.example/rentals" },
    { rank: 3, title: "Lakeside Hall gallery", link: "https://lakesidehall.example/gallery" },
    { rank: 4, title: "Permits", link: "https://www.oaklandca.gov/permits" },
  ],
});

const request: BrightDataRequestFn = async (req) => {
  if (req.url.includes("google.com/search")) return pageResponse(serpBody);
  if (req.url.includes("cocinarosa")) return pageResponse(CATERER_PAGE);
  return pageResponse(VENUE_PAGE);
};

const extract: ExtractCall = async (input) => {
  const p = input.markdown;
  const facts = [];
  if (p.includes("120 guests")) facts.push({ field: "capacity" as const, value: 120, quote: "Our hall seats up to 120 guests." });
  if (p.includes("$1,100")) facts.push({ field: "rental_fee" as const, value: 1100, quote: "Saturday rental: $1,100." });
  if (p.includes("Outside caterers")) facts.push({ field: "outside_catering" as const, value: "any", quote: "Outside caterers welcome." });
  if (p.includes("555-0142")) facts.push({ field: "contact_phone" as const, value: "(510) 555-0142", quote: "Call us at (510) 555-0142." });
  if (p.includes("$32")) facts.push({ field: "price_per_guest" as const, value: 32, quote: "Packages start at $32 per guest." });
  if (p.includes("Mexican")) facts.push({ field: "cuisine" as const, value: "Mexican", quote: "Authentic Mexican catering." });
  if (p.includes("Vegetarian")) facts.push({ field: "vegetarian_options" as const, value: true, quote: "Vegetarian menus available." });
  return { ok: true, output: { facts } };
};

const places: RunPlacesActor = async () => [
  { title: "Cocina Rosa", website: "https://cocinarosa.example/", url: "https://maps.example/rosa", placeId: "p1", phone: "+1 510-555-0199" },
  { title: "No Site Tacos", url: "https://maps.example/tacos", placeId: "p2" },
];

const brief: EventBrief = {
  id: "brief_1", version: 2, occasion: "baby shower", city: "Oakland", dateTarget: null, guestRange: { min: 75, max: 100 },
  budget: { amountCents: 200000, scope: "venue_only" },
  requirements: [
    { id: "r1", key: "capacity", label: "Fits 100", value: 100, priority: "MUST_HAVE", appliesTo: "venue" },
    { id: "r2", key: "cuisine", label: "Mexican", value: "Mexican", priority: "PREFERENCE", appliesTo: "catering" },
  ],
  confirmedAt: "2026-10-24T20:00:00Z",
};

const fast = { softTimeoutMs: 20, hardTimeoutMs: 200, retryDelayMs: 0 };
const deps = (over: Partial<JobDeps> = {}): JobDeps => ({
  search: { zone: "serp", request, ...fast },
  fetch: { zone: "unlocker", request, ...fast },
  extract: { call: extract },
  vendors: { run: places, ...fast },
  ...over,
});

describe("research job", () => {
  it("discovers, reads, and returns a snapshot the web app accepts", async () => {
    const job = createJob("job_1", brief);
    await runJob(job, deps());
    const snap = ResearchSnapshot.parse(toSnapshot(job));

    // Neither page lists every field, so their rows (and the job) are partial, not complete.
    assert.equal(snap.job.status, "partial");
    assert.ok(snap.job.finishedAt);
    assert.equal(snap.job.origin.mode, "live");
    // Yelp and the .gov page are skipped; one page per domain.
    const pages = snap.job.sources.filter((s) => s.provider === "bd_unlocker").map((s) => s.url);
    assert.deepEqual(pages.sort(), ["https://cocinarosa.example/", "https://lakesidehall.example/rentals"]);

    const hall = snap.vendors.find((v) => v.category === "venue")!;
    assert.equal(hall.name, "Lakeside Hall");
    assert.equal(hall.fictional, false);
    assert.equal(hall.contact?.phone, "(510) 555-0142");
    assert.match(hall.contact!.sourceLabel, /lakesidehall\.example/);

    const fact = (vendorId: string, field: string) => snap.facts.find((f) => f.vendorId === vendorId && f.field === field)!;
    assert.equal(fact(hall.id, "rental_fee").value, 110000, "cents");
    assert.equal(fact(hall.id, "rental_fee").qualifier, "exact");
    assert.equal(fact(hall.id, "outside_catering").value, true);
    assert.equal(fact(hall.id, "climate_control").unknownReason, "not_on_page");
    assert.ok(fact(hall.id, "capacity").retrievedAt);

    const rosa = snap.vendors.find((v) => v.category === "catering")!;
    assert.equal(fact(rosa.id, "price_per_guest").value, 3200);
    assert.equal(fact(rosa.id, "price_per_guest").qualifier, "starting_at");
    assert.ok(!snap.vendors.some((v) => v.name === "No Site Tacos"), "no website, not researched");

    // The web app's own matcher works on these facts.
    assert.equal(evaluateVendor(brief, hall, snap.facts).matchStatus, "verified_match");
  });

  it("seed URLs are researched first, without a search result", async () => {
    const job = createJob("job_s", brief);
    await runJob(job, deps({ seeds: [{ url: "https://seeded.example/", name: "Seeded Hall" }] }));
    assert.ok(toSnapshot(job).vendors.some((v) => v.name === "Seeded Hall"));
  });

  it("ablation: a bad Bright Data key leaves every fact unknown / source_failed", async () => {
    let calls = 0;
    const counting: ExtractCall = async (...a) => (calls++, extract(...a));
    const bad: BrightDataRequestFn = async () => badKeyResponse();
    const job = createJob("job_bad", { ...brief });
    await runJob(job, deps({ search: { zone: "serp", request: bad, ...fast }, fetch: { zone: "u", request: bad, ...fast }, extract: { call: counting } }));
    const snap = toSnapshot(job);

    assert.equal(calls, 0);
    assert.ok(snap.facts.length > 0);
    assert.ok(snap.facts.every((f) => f.state === "unknown" && f.unknownReason === "source_failed" && f.value === undefined));
    assert.equal(snap.job.status, "partial", "Apify still found caterers, but nothing was read");
  });

  it("a cancelled job stops and marks unfinished rows", async () => {
    const slow: BrightDataRequestFn = async (req) => (await sleep(80), request(req));
    const job = createJob("job_c", brief);
    const running = runJob(job, deps({ search: { zone: "s", request: slow, softTimeoutMs: 20, hardTimeoutMs: 500, retryDelayMs: 0 } }));
    await sleep(10);
    cancelJob(job);
    await running;
    const snap = toSnapshot(job);
    assert.equal(snap.job.status, "cancelled");
    assert.ok(snap.job.sources.some((s) => s.error === "Cancelled by you"));
    assert.ok(snap.job.sources.every((s) => !["queued", "searching", "fetching", "extracting", "slow"].includes(s.status)));
  });
});

describe("snapshot helpers", () => {
  it("names a venue from its page title", () => {
    assert.equal(nameFromTitle({ title: "Event Rentals | Palace of Fine Arts", domain: "palaceoffinearts.com" }), "Palace of Fine Arts");
    assert.equal(nameFromTitle({ title: "The Midway", domain: "themidwaysf.com" }), "The Midway");
    assert.equal(vendorIdFor("venue", "https://www.palaceoffinearts.com/x"), "v_palaceoffinearts_com");
  });

  it("price wording decides the qualifier, in code", () => {
    assert.equal(priceQualifier({ quote: "Saturday rental: $1,100" }), "exact");
    assert.equal(priceQualifier({ quote: "Packages from $35 per person" }), "starting_at");
    assert.equal(priceQualifier({ quote: "about $40 per guest" }), "approximate");
    assert.equal(priceQualifier({ quote: "$30–$45 per guest", confidence: "derived" }), "approximate");
  });

  it("invalid_value maps to quote_mismatch, and unknown facts carry no value", () => {
    const f = toWebFact({ entityId: "v1", field: "capacity", state: "unknown", unknownReason: "invalid_value", sourceId: "s1", appliesTo: ["v1"] }, undefined)!;
    assert.equal(f.unknownReason, "quote_mismatch");
    assert.equal(f.value, undefined);
  });

  it("drops fields the web contract doesn't have", () => {
    assert.equal(toWebFact({ entityId: "v1", field: "application_lead_days", state: "verified", value: 60, appliesTo: [] }, undefined), undefined);
  });
});
