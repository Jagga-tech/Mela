import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateVendor, rankCategory, shortlist } from "../src/mela/domain/match";
import { demoAdapter } from "../src/mela/adapters/demo";
import * as fx from "../src/mela/fixtures/oakland-baby-shower";
import type { SourceFact } from "../src/mela/contracts";
import { demoBrief } from "./mela-helpers";


const vendor = (id: string) => fx.vendors.find((v) => v.id === id)!;
const rec = (id: string, facts: SourceFact[] = fx.sourceFacts) => evaluateVendor(demoBrief(), vendor(id), facts);

test("research refuses to start before the host confirms the brief", async () => {
  const unconfirmed = { ...demoBrief(), confirmedAt: null };
  await assert.rejects(demoAdapter().startResearch(unconfirmed), /Confirm your brief/);
});

test("all must-haves verified → verified match with reasons from facts", () => {
  const r = rec("v-lakeview-loft");
  assert.equal(r.matchStatus, "verified_match");
  assert.equal(r.price.priceType, "published");
  assert.equal(r.price.amountCents, 125000);
  assert.ok(r.checks.every((c) => c.priority !== "MUST_HAVE" || c.factIds.length > 0));
});

test("unknown source facts stay unknown and block a verified match", () => {
  const r = rec("v-fruitvale-hall");
  assert.equal(r.matchStatus, "possible_match");
  assert.equal(r.checks.find((c) => c.label === "Climate control")?.result, "unknown");
  assert.ok(r.unknowns.some((u) => /climate/i.test(u)));
  assert.equal(rec("c-taquiza-lupita").matchStatus, "possible_match");
});

test("a known must-have violation is excluded, never shown as a match", () => {
  assert.equal(rec("v-temescal-studio").matchStatus, "excluded"); // capacity 90 < 100
  assert.equal(rec("v-jacklondon-roof").matchStatus, "excluded"); // no outside catering
  assert.equal(rec("c-brasa-grill").matchStatus, "excluded"); // no vegetarian
  const venues = rankCategory(demoBrief(), fx.vendors.filter((v) => v.category === "venue"), fx.sourceFacts);
  const s = shortlist(venues, fx.sourceFacts);
  assert.ok(s.top.every((r) => r.matchStatus !== "excluded"));
  assert.deepEqual(s.excluded.map((r) => r.vendorId).sort(), ["v-jacklondon-roof", "v-temescal-studio"]);
  assert.deepEqual(s.unchecked.map((r) => r.vendorId), ["v-dimond-room"]);
});

test("conflicting sources are conflicting, not a match", () => {
  const extra: SourceFact = { id: "x", vendorId: "v-lakeview-loft", field: "capacity", state: "verified", value: 80, quote: "Max 80" };
  const r = rec("v-lakeview-loft", [...fx.sourceFacts, extra]);
  assert.equal(r.checks.find((c) => c.requirementId === "capacity")?.result, "conflicting");
  assert.equal(r.matchStatus, "possible_match");
});

test("estimated prices are never labeled published; labels need evidence", () => {
  const masa = rec("c-masa-fuego");
  assert.equal(masa.price.priceType, "estimated");
  const caterers = rankCategory(demoBrief(), fx.vendors.filter((v) => v.category === "catering"), fx.sourceFacts);
  const low = caterers.find((r) => r.labels.includes("lowest_published_estimate"));
  assert.equal(low?.price.priceType, "published");
  assert.equal(caterers.find((r) => r.labels.includes("best_fit"))?.matchStatus, "verified_match");
  assert.ok(!JSON.stringify(caterers).match(/percent|score"/i));
});

test("partial, blocked, empty and slow research states are reported as they are", async () => {
  const svc = demoAdapter();
  const first = await svc.startResearch(demoBrief());
  const mid = await svc.getResearch({ ...first.job, startedAt: new Date(Date.now() - 3000).toISOString() }, demoBrief());
  assert.ok(mid.job.sources.some((s) => s.status === "slow"));
  assert.equal(mid.job.status, "running");
  const done = await svc.getResearch({ ...first.job, startedAt: new Date(Date.now() - 60_000).toISOString() }, demoBrief());
  const by = (st: string) => done.job.sources.filter((s) => s.status === st).length;
  assert.ok(by("partial") >= 1 && by("blocked") === 1 && by("empty") === 1);
  assert.equal(done.job.status, "partial");
  assert.equal(done.job.origin.mode, "demo");
  // nothing from the blocked source becomes a fact
  assert.equal(done.facts.some((f) => f.vendorId === "v-dimond-room"), false);
});

test("cancelled research says so", async () => {
  const svc = demoAdapter();
  const first = await svc.startResearch(demoBrief());
  await svc.cancelResearch(first.job.id);
  const s = await svc.getResearch(first.job, demoBrief());
  assert.equal(s.job.status, "cancelled");
});

test("a venue cap isn't 'met' while other fees are unknown, and venue needs don't leak onto caterers", () => {
  const fruitvale = rec("v-fruitvale-hall");
  assert.equal(fruitvale.checks.find((c) => c.requirementId === "venue_budget")?.result, "unknown");
  assert.equal(rec("v-lakeview-loft").checks.find((c) => c.requirementId === "venue_budget")?.result, "meets");
  assert.ok(rec("c-cocina-abuela").checks.every((c) => !["indoor_outdoor", "capacity", "venue_budget"].includes(c.requirementId)));
});
