// Runs under --conditions=react-server (spawned by tests/finance-routes.test.ts) so the real, "server-only"
// research job store and snapshot mapping load. Nothing here touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FinanceCase, type EventBrief } from "../../src/mela/contracts";
import { createJob } from "../../src/lib/research/job";
import { saveJob } from "../../src/lib/research/jobStore";
import { newSource, type ExtractedFact } from "../../src/lib/research/contract";
import { POST as openCase } from "../../src/app/api/finance/cases/route";

const brief = (id: string): EventBrief => ({
  id, version: 1, occasion: "Quinceañera", city: "San Francisco", dateTarget: null, guestRange: { min: 90, max: 110 },
  budget: { amountCents: null, scope: "venue_only" }, requirements: [], confirmedAt: "2026-10-24T20:00:00Z",
});

function seedJob(jobId: string, briefId: string, rentDollars: number | null) {
  const job = createJob(jobId, brief(briefId));
  const src = { ...newSource({ url: "https://hall.example/rentals", provider: "bd_unlocker", sourceType: "venue_site" }), status: "found" as const, attempt: 1, fetchedAt: "2026-10-24T20:42:16.000Z" };
  job.sources.set(src.id, src);
  job.sourceVendor.set(src.id, "v_hall_example");
  job.vendors.set("v_hall_example", { id: "v_hall_example", name: "Mission Hall", category: "venue", website: src.url });
  const facts: ExtractedFact[] = rentDollars === null
    ? [{ entityId: "v_hall_example", field: "rental_fee", state: "unknown", unknownReason: "not_on_page", sourceId: src.id, appliesTo: ["v_hall_example"] }]
    : [{ entityId: "v_hall_example", field: "rental_fee", state: "verified", value: rentDollars, quote: `Saturday rental: $${rentDollars.toLocaleString("en-US")}`, confidence: "exact", sourceId: src.id, appliesTo: ["v_hall_example"] }];
  job.facts.push(...facts);
  job.done = true;
  job.finishedAt = "2026-10-24T20:43:00.000Z";
  saveJob(job);
}

const post = (body: unknown) => new Request("http://test/api/finance/cases", { method: "POST", body: JSON.stringify(body) });

test("quotes from the most recent research job for the brief, in cents", async () => {
  seedJob("job_old", "brief_live", 900);
  seedJob("job_new", "brief_live", 1100);
  const res = await openCase(post({ briefId: "brief_live", venueId: "v_hall_example" }));
  assert.equal(res.status, 200);
  const fc = FinanceCase.parse(await res.json());
  assert.equal(fc.quote.totalCents, 110000);
  assert.equal(fc.quote.lines[0]!.totalCents, 110000);
  assert.match(fc.audit[0]!.detail ?? "", /“Saturday rental: \$1,100” \(hall\.example\/rentals, read 2026-10-24T20:42:16\.000Z\)/);
});

test("an explicit jobId picks that job, and only if it belongs to the brief", async () => {
  let res = await openCase(post({ briefId: "brief_live", venueId: "v_hall_example", jobId: "job_old" }));
  assert.equal(FinanceCase.parse(await res.json()).quote.totalCents, 90000);
  res = await openCase(post({ briefId: "brief_other", venueId: "v_hall_example", jobId: "job_old" }));
  assert.equal(res.status, 404);
});

test("a live job without a published price is refused", async () => {
  seedJob("job_noprice", "brief_noprice", null);
  const res = await openCase(post({ briefId: "brief_noprice", venueId: "v_hall_example" }));
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /no published price \(the rental fee isn't on its page\)/);
});
