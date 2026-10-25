import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunPlacesActor } from "../../src/lib/research/apify";
import type { BrightDataRequestFn } from "../../src/lib/research/brightdata";
import { ResearchResult, type ResearchSource } from "../../src/lib/research/contract";
import type { ExtractCall } from "../../src/lib/research/extract";
import { MAX_SOURCES, runResearch, TooManySourcesError, type ResearchTarget, type RunResearchDeps } from "../../src/lib/research/pipeline";
import { after, badKeyResponse, pageResponse, sequence } from "./helpers";

const VENUE_PAGE = `# Palace Rotunda\n\nThe rotunda lawn holds up to 150 guests. Wheelchair accessible paths throughout. ${"Lorem ipsum. ".repeat(10)}`;
const RULES_PAGE = `# Park events\n\nSubmit applications at least 60 days before your event. The application fee is $85. ${"Lorem ipsum. ".repeat(10)}`;

const venue: ResearchTarget = {
  entity: { id: "rotunda", name: "Palace Rotunda", kind: "venue" },
  url: "https://venue.example/rotunda",
  sourceType: "venue_site",
  fields: ["capacity", "step_free_access", "alcohol"],
  appliesTo: ["rotunda"],
};
const rules: ResearchTarget = {
  entity: { id: "rec-park", name: "Rec & Park events", kind: "authority" },
  url: "https://rules.example/events",
  sourceType: "official_city",
  fields: ["application_lead_days", "application_fee"],
  appliesTo: ["rotunda", "dolores"],
};

// Answers like a careful model: values with exact quotes, null when absent.
const goodExtract: ExtractCall = async (input) => {
  const page = input.markdown;
  const facts = [];
  if (page.includes("150 guests")) facts.push({ field: "capacity" as const, value: 150, quote: "The rotunda lawn holds up to 150 guests." });
  if (page.includes("Wheelchair")) facts.push({ field: "step_free_access" as const, value: true, quote: "Wheelchair accessible paths throughout." });
  if (page.includes("60 days")) facts.push({ field: "application_lead_days" as const, value: 60, quote: "at least 60 days before your event" });
  if (page.includes("$85")) facts.push({ field: "application_fee" as const, value: 85, quote: "The application fee is $85." });
  facts.push({ field: "alcohol" as const, value: null, quote: null });
  return { ok: true, output: { facts } };
};

const byUrl: BrightDataRequestFn = async (req) =>
  req.url.includes("rotunda") ? pageResponse(VENUE_PAGE) : pageResponse(RULES_PAGE);

function deps(request: BrightDataRequestFn, call: ExtractCall, extra: Partial<RunResearchDeps> = {}) {
  const rows: ResearchSource[] = [];
  const d: RunResearchDeps = {
    onSource: (s) => {
      rows.push(s);
    },
    fetch: { zone: "z", softTimeoutMs: 20, hardTimeoutMs: 200, retryDelayMs: 0, request },
    extract: { call },
    ...extra,
  };
  return { d, rows };
}

const statusesFor = (rows: ResearchSource[], url: string) => rows.filter((r) => r.url === url).map((r) => r.status);

describe("runResearch", () => {
  it("queues everything first, then fetch → extracting → found / partial, and returns a valid result", async () => {
    const { d, rows } = deps(byUrl, goodExtract);
    const result = await runResearch({ eventId: "evt-1", targets: [venue, rules] }, d);
    ResearchResult.parse(result);

    assert.deepEqual(rows.slice(0, 2).map((r) => r.status), ["queued", "queued"]);
    assert.deepEqual(statusesFor(rows, venue.url), ["queued", "fetching", "extracting", "partial"]);
    assert.deepEqual(statusesFor(rows, rules.url), ["queued", "fetching", "extracting", "found"]);

    const fact = (entity: string, field: string) => result.facts.find((f) => f.entityId === entity && f.field === field)!;
    assert.equal(fact("rotunda", "capacity").confidence, "exact");
    assert.equal(fact("rotunda", "step_free_access").confidence, "derived");
    assert.equal(fact("rotunda", "alcohol").unknownReason, "not_on_page");
    assert.equal(fact("rec-park", "application_fee").value, 85);
    assert.deepEqual(fact("rec-park", "application_fee").appliesTo, ["rotunda", "dolores"]);
    assert.equal(result.facts.length, 5, "one fact per requested field");
    assert.deepEqual(result.entities?.map((e) => e.id), ["rotunda", "rec-park"]);
  });

  it("a paraphrased quote is downgraded, never shown as verified", async () => {
    const paraphrase: ExtractCall = async () => ({
      ok: true,
      output: { facts: [{ field: "capacity", value: 150, quote: "Fits about 150 people." }] },
    });
    const { d } = deps(byUrl, paraphrase);
    const result = await runResearch({ eventId: "e", targets: [venue] }, d);
    const capacity = result.facts.find((f) => f.field === "capacity")!;
    assert.equal(capacity.state, "unknown");
    assert.equal(capacity.unknownReason, "quote_mismatch");
    assert.equal(capacity.value, undefined);
  });

  it("ablation: a bad Bright Data key leaves every fact unknown / source_failed", async () => {
    let extractCalls = 0;
    const counting: ExtractCall = async (...args) => {
      extractCalls++;
      return goodExtract(...args);
    };
    const { request } = sequence(after(1, badKeyResponse()));
    const { d, rows } = deps(request, counting);
    const result = await runResearch({ eventId: "e", targets: [venue, rules] }, d);

    assert.equal(extractCalls, 0, "nothing reaches the model without a page");
    assert.ok(result.facts.length > 0);
    for (const f of result.facts) {
      assert.equal(f.state, "unknown");
      assert.equal(f.unknownReason, "source_failed");
      assert.equal(f.value, undefined);
    }
    assert.ok(result.sources.every((s) => s.status === "error"));
    assert.ok(rows.some((r) => /API key/.test(r.error ?? "")));
  });

  it("an extraction failure shows on the source and leaves its facts source_failed", async () => {
    const failing: ExtractCall = async () => ({ ok: false, reason: "LLM rate limited" });
    const { d } = deps(byUrl, failing);
    const result = await runResearch({ eventId: "e", targets: [venue] }, d);
    assert.equal(result.sources[0]!.status, "error");
    assert.equal(result.sources[0]!.error, "LLM rate limited");
    assert.ok(result.facts.every((f) => f.unknownReason === "source_failed"));
  });

  it("vendors run alongside and land in the result; an Apify failure doesn't touch venue facts", async () => {
    const okRun: RunPlacesActor = async () => [{ title: "Dulce Catering", url: "https://maps.example/dulce", placeId: "p1" }];
    const { d } = deps(byUrl, goodExtract, { vendors: { softTimeoutMs: 20, hardTimeoutMs: 200, retryDelayMs: 0, run: okRun } });
    const result = await runResearch({ eventId: "e", targets: [venue], vendorQueries: ["caterer"] }, d);
    assert.deepEqual(result.vendors?.map((v) => v.name), ["Dulce Catering"]);
    assert.equal(result.sources.find((s) => s.provider === "apify")!.status, "found");

    const failRun: RunPlacesActor = async () => {
      throw Object.assign(new Error("bad token"), { statusCode: 401 });
    };
    const second = deps(byUrl, goodExtract, { vendors: { softTimeoutMs: 20, hardTimeoutMs: 200, retryDelayMs: 0, run: failRun } });
    const r2 = await runResearch({ eventId: "e", targets: [venue], vendorQueries: ["caterer"] }, second.d);
    assert.equal(r2.sources.find((s) => s.provider === "apify")!.status, "error");
    assert.equal(r2.facts.find((f) => f.field === "capacity")!.state, "verified");
  });

  it("saves facts per source as each finishes", async () => {
    const batches: number[] = [];
    const { d } = deps(byUrl, goodExtract, { onFacts: (f) => void batches.push(f.length) });
    await runResearch({ eventId: "e", targets: [venue, rules] }, d);
    assert.deepEqual(batches.sort(), [2, 3]);
  });

  it("refuses more than MAX_SOURCES before creating any rows", async () => {
    const { d, rows } = deps(byUrl, goodExtract);
    const targets = Array.from({ length: MAX_SOURCES + 1 }, (_, i) => ({ ...venue, url: `https://venue.example/${i}` }));
    await assert.rejects(runResearch({ eventId: "e", targets }, d), TooManySourcesError);
    assert.equal(rows.length, 0);
  });
});
