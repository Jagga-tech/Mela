// Route-level tests for /api/finance/**. The live research lookup and Stripe are faked (no network).
// The real research job store is exercised by tests/finance/live-research.check.ts (see the last test).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { FinanceCase, STRIPE_TEST_LABEL, type Actor, type EventBrief, type ResearchSnapshot, type SourceFact } from "../src/mela/contracts";
import { MELA_AP_AGENT } from "../src/mela/domain/finance";
import { stripeTestCharge } from "../src/integrations/pay";
import { clearCases } from "../src/lib/finance/caseStore";
import { configureFinance, resetFinanceDeps } from "../src/lib/finance/deps";
import type { LiveResearch } from "../src/lib/finance/research";
import { POST as openCase } from "../src/app/api/finance/cases/route";
import { GET as getCaseRoute } from "../src/app/api/finance/cases/[id]/route";
import { POST as decideRoute } from "../src/app/api/finance/cases/[id]/decisions/route";
import { POST as testPayRoute } from "../src/app/api/finance/cases/[id]/test-payment/route";

const manager: Actor = { kind: "human", id: "usr_mgr", name: "Ana Ruiz", role: "ap_manager" };
const VENUE = "v_hall_example";
const URL_ = "https://hall.example/rentals";

const brief: EventBrief = {
  id: "brief_1", version: 2, occasion: "Quinceañera", city: "San Francisco", dateTarget: "2026-12-06", guestRange: { min: 90, max: 110 },
  budget: { amountCents: 500000, scope: "venue_only" }, hostName: "Maya", requirements: [], confirmedAt: "2026-10-24T20:00:00Z",
};

const fact = (field: SourceFact["field"], over: Partial<SourceFact>): SourceFact => ({
  id: `s1:${VENUE}:${field}`, vendorId: VENUE, field, state: "verified", sourceId: "s1", url: URL_, retrievedAt: "2026-10-24T20:42:16Z", ...over,
});

function research(facts: SourceFact[], over: Partial<ResearchSnapshot["job"]> = {}): LiveResearch {
  return {
    brief,
    snapshot: {
      job: {
        id: "job_1", briefId: brief.id, briefVersion: brief.version, status: "complete", startedAt: "2026-10-24T20:42:00Z",
        origin: { mode: "live", provider: "bright_data", label: "live" },
        sources: [{ id: "s1", url: URL_, label: "hall.example/rentals", provider: "bd_unlocker", sourceType: "venue_site", status: "found", attempt: 1, vendorId: VENUE }],
        ...over,
      },
      vendors: [
        { id: VENUE, name: "Mission Hall", category: "venue", area: "San Francisco", fictional: false },
        { id: "c_tacos", name: "Taco Cart", category: "catering", area: "San Francisco", fictional: false },
      ],
      facts,
      reviews: [],
    },
  };
}

const priced = () => research([
  fact("rental_fee", { value: 110000, qualifier: "exact", quote: "Saturday rental: $1,100" }),
  fact("cleaning_fee", { value: 15000, qualifier: "exact", quote: "Cleaning fee $150" }),
  fact("capacity", { value: 120, quote: "Seated capacity: 120 guests" }),
]);

let lookup: LiveResearch | undefined;
let lookups: { briefId: string; jobId?: string }[] = [];

beforeEach(() => {
  clearCases();
  resetFinanceDeps();
  lookup = priced();
  lookups = [];
  configureFinance({ findResearch: async (briefId, jobId) => (lookups.push({ briefId, jobId }), lookup && briefId === lookup.brief.id ? lookup : undefined) });
  delete process.env.STRIPE_SECRET_KEY;
});

const post = (body: unknown) => new Request("http://test/api", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function call(res: Promise<Response>) {
  const r = await res;
  return { status: r.status, json: (await r.json()) as Record<string, unknown> & { error?: string } };
}

async function opened(): Promise<FinanceCase> {
  const r = await call(openCase(post({ briefId: brief.id, venueId: VENUE })));
  assert.equal(r.status, 200, r.json.error);
  return FinanceCase.parse(r.json);
}

async function released(): Promise<FinanceCase> {
  const fc = await opened();
  const r = await call(decideRoute(post({ decision: "approve_line", reason: "Setup fee agreed on the call", actor: manager }), params(fc.id)));
  assert.equal(r.status, 200, r.json.error);
  return FinanceCase.parse(r.json);
}

// ---------- open a case ----------

test("happy path: the quote comes from the venue's verified exact prices; the invoice is simulated and held", async () => {
  const fc = await opened();
  assert.deepEqual(fc.quote.lines.map((l) => [l.label, l.totalCents]), [["Venue rental", 110000], ["Cleaning fee", 15000]]);
  assert.equal(fc.quote.totalCents, 125000);
  assert.equal(fc.quote.vendorId, VENUE);
  assert.equal(fc.quote.vendorName, "Mission Hall");
  assert.equal(fc.invoice.totalCents, 140000);
  assert.equal(fc.outcome, "held");
  assert.equal(fc.exception?.deltaCents, 15000);
  assert.deepEqual(fc.exception?.failingLineIds, ["L3"]);
  assert.equal(fc.paymentDraft.status, "held");
  assert.equal(fc.paymentDraft.simulated, true);
  assert.equal(fc.testPayment, undefined);
  assert.equal(fc.origin.mode, "live");
  assert.match(fc.origin.label, /invoice SIMULATED/);
  assert.match(fc.eventLabel, /Quinceañera · San Francisco · host: Maya/);
  // provenance: the verbatim quote and its page are in the audit trail, before the agent's steps
  assert.match(fc.audit[0]!.detail ?? "", /“Saturday rental: \$1,100” \(hall\.example\/rentals/);
  assert.ok(fc.audit.some((a) => /is SIMULATED/.test(a.action)));
  const times = fc.audit.map((a) => Date.parse(a.at));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.deepEqual(lookups, [{ briefId: brief.id, jobId: undefined }]);

  const got = await call(getCaseRoute(new Request("http://test"), params(fc.id)));
  assert.equal(got.status, 200);
  assert.deepEqual(FinanceCase.parse(got.json), fc);
});

test("an estimate cleaning fee is left out of the quote and the audit says why", async () => {
  lookup = research([
    fact("rental_fee", { value: 110000, qualifier: "exact", quote: "Saturday rental: $1,100" }),
    fact("cleaning_fee", { value: 15000, qualifier: "approximate", quote: "cleaning about $150" }),
  ]);
  const fc = await opened();
  assert.deepEqual(fc.quote.lines.map((l) => l.id), ["L1"]);
  assert.equal(fc.invoice.totalCents, 125000);
  assert.ok(fc.audit.some((a) => /Cleaning fee left out/.test(a.action)));
});

test("jobId is passed through to the research lookup", async () => {
  const r = await call(openCase(post({ briefId: brief.id, venueId: VENUE, jobId: "job_1" })));
  assert.equal(r.status, 200);
  assert.deepEqual(lookups, [{ briefId: brief.id, jobId: "job_1" }]);
});

test("no published price: refused with a sentence, nothing stored", async () => {
  lookup = research([fact("rental_fee", { state: "unknown", unknownReason: "not_on_page" })]);
  const r = await call(openCase(post({ briefId: brief.id, venueId: VENUE })));
  assert.equal(r.status, 422);
  assert.equal(r.json.error, "Mission Hall has no published price (the rental fee isn't on its page), so there is no quote to check an invoice against.");

  lookup = research([]);
  assert.match((await call(openCase(post({ briefId: brief.id, venueId: VENUE })))).json.error!, /no published price, so there is no quote/);
});

test("an estimate, a failed page, or disagreeing sources never become a quote", async () => {
  lookup = research([fact("rental_fee", { value: 90000, qualifier: "starting_at", quote: "Rentals from $900" })]);
  let r = await call(openCase(post({ briefId: brief.id, venueId: VENUE })));
  assert.equal(r.status, 422);
  assert.match(r.json.error!, /only publishes an estimate \(“Rentals from \$900”\)/);

  lookup = research([fact("rental_fee", { state: "unknown", unknownReason: "source_failed" })]);
  r = await call(openCase(post({ briefId: brief.id, venueId: VENUE })));
  assert.equal(r.status, 422);
  assert.match(r.json.error!, /page failed to load/);

  lookup = research([
    fact("rental_fee", { value: 110000, qualifier: "exact", quote: "$1,100" }),
    fact("rental_fee", { id: "s2:x", sourceId: "s2", value: 130000, qualifier: "exact", quote: "$1,300" }),
  ]);
  r = await call(openCase(post({ briefId: brief.id, venueId: VENUE })));
  assert.equal(r.status, 409);
  assert.match(r.json.error!, /sources disagree on the rental fee \(\$1,100 vs \$1,300\)/);
});

test("missing research, unknown venue, caterer, running research and bad bodies are refused honestly", async () => {
  let r = await call(openCase(post({ briefId: "brief_other", venueId: VENUE })));
  assert.equal(r.status, 404);
  assert.match(r.json.error!, /no live research for this brief/);

  r = await call(openCase(post({ briefId: brief.id, venueId: "v_nope" })));
  assert.equal(r.status, 404);
  assert.match(r.json.error!, /isn't in the live research/);

  r = await call(openCase(post({ briefId: brief.id, venueId: "c_tacos" })));
  assert.equal(r.status, 422);
  assert.match(r.json.error!, /Taco Cart is a caterer/);

  const running = research([], { status: "running" });
  running.snapshot.vendors = [];
  lookup = running;
  r = await call(openCase(post({ briefId: brief.id, venueId: VENUE })));
  assert.equal(r.status, 409);
  assert.match(r.json.error!, /still being researched/);

  for (const bad of [{}, { briefId: brief.id }, { briefId: "", venueId: VENUE }, "not json"]) {
    r = await call(openCase(post(bad)));
    assert.equal(r.status, 422, JSON.stringify(bad));
    assert.equal(typeof r.json.error, "string");
  }
});

// ---------- unknown cases ----------

test("unknown case id: 404 with a sentence on every case route", async () => {
  for (const r of [
    await call(getCaseRoute(new Request("http://test"), params("case_nope"))),
    await call(decideRoute(post({ decision: "approve_line", reason: "fine fine", actor: manager }), params("case_nope"))),
    await call(testPayRoute(post({ actor: manager }), params("case_nope"))),
  ]) {
    assert.equal(r.status, 404);
    assert.match(r.json.error!, /isn't on this server/);
  }
});

// ---------- decisions ----------

test("decision body is validated; a reason is required", async () => {
  const fc = await opened();
  for (const bad of [
    { decision: "pay_now", reason: "because", actor: manager },
    { decision: "approve_line", actor: manager },
    { decision: "approve_line", reason: "ok ok", actor: { id: "x" } },
    "nope",
  ]) {
    const r = await call(decideRoute(post(bad), params(fc.id)));
    assert.equal(r.status, 422, JSON.stringify(bad));
  }
  const r = await call(decideRoute(post({ decision: "approve_line", reason: "  ", actor: manager }), params(fc.id)));
  assert.equal(r.status, 422);
  assert.match(r.json.error!, /written reason/);
});

test("the agent can't approve its own exception, and the case stays held", async () => {
  const fc = await opened();
  let r = await call(decideRoute(post({ decision: "approve_line", reason: "looks fine to me", actor: MELA_AP_AGENT }), params(fc.id)));
  assert.equal(r.status, 403);
  assert.match(r.json.error!, /Only a human AP manager/);
  r = await call(decideRoute(post({ decision: "approve_line", reason: "looks fine", actor: { ...manager, id: fc.paymentDraft.requestedBy } }), params(fc.id)));
  assert.equal(r.status, 403);
  r = await call(decideRoute(post({ decision: "approve_line", reason: "looks fine", actor: { ...manager, role: "host" } }), params(fc.id)));
  assert.equal(r.status, 403);
  const after = FinanceCase.parse((await call(getCaseRoute(new Request("http://test"), params(fc.id)))).json);
  assert.equal(after.paymentDraft.status, "held");
  assert.equal(after.decisions.length, 0);
});

test("reject revises the draft; a second decision on a closed case is refused", async () => {
  const fc = await opened();
  let r = await call(decideRoute(post({ decision: "reject_line", reason: "Not in the quote", actor: manager }), params(fc.id)));
  assert.equal(r.status, 200);
  const next = FinanceCase.parse(r.json);
  assert.equal(next.paymentDraft.status, "revised_unreleased");
  assert.equal(next.paymentDraft.amountCents, 125000);
  assert.equal(next.decisions[0]!.reason, "Not in the quote");
  r = await call(decideRoute(post({ decision: "approve_line", reason: "changed my mind", actor: manager }), params(fc.id)));
  assert.equal(r.status, 409);
  assert.match(r.json.error!, /no open exception/);
});

test("approve releases the draft for manual payment; PaymentDraft keeps simulated: true and no paid state", async () => {
  const fc = await released();
  assert.equal(fc.paymentDraft.status, "released_for_manual_payment");
  assert.equal(fc.paymentDraft.simulated, true);
  assert.equal(fc.exception?.status, "resolved_approved");
});

// ---------- Stripe test payment ----------

type Seen = { url: string; init?: RequestInit };
function fakeStripe(responses: { status?: number; json: unknown }[], seen: Seen[] = []) {
  let i = 0;
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as typeof fetch;
  configureFinance({ stripeCharge: (key) => stripeTestCharge(key, f) });
  return seen;
}
const passGate = () => configureFinance({ vendorRiskGate: async () => ({ ok: true }) });

test("test payment needs a released draft and a human AP manager", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  passGate();
  const seen = fakeStripe([{ json: { id: "pi_1", status: "succeeded", livemode: false } }]);
  const held = await opened();
  let r = await call(testPayRoute(post({ actor: manager }), params(held.id)));
  assert.equal(r.status, 409);
  assert.match(r.json.error!, /still held/);

  const fc = await released();
  r = await call(testPayRoute(post({ actor: MELA_AP_AGENT }), params(fc.id)));
  assert.equal(r.status, 403);
  assert.match(r.json.error!, /agent can't pay/);
  r = await call(testPayRoute(post({ actor: { ...manager, role: "host" } }), params(fc.id)));
  assert.equal(r.status, 403);
  r = await call(testPayRoute(post({}), params(fc.id)));
  assert.equal(r.status, 422);
  assert.equal(seen.length, 0);
});

test("Stripe: no key is 'not connected'; live keys are refused before any request", async () => {
  passGate();
  const seen = fakeStripe([{ json: { id: "pi_1", status: "succeeded", livemode: false } }]);
  const fc = await released();
  let r = await call(testPayRoute(post({ actor: manager }), params(fc.id)));
  assert.equal(r.status, 503);
  assert.match(r.json.error!, /STRIPE_SECRET_KEY is not set/);
  for (const key of ["sk_live_abc", "rk_live_abc"]) {
    process.env.STRIPE_SECRET_KEY = key;
    r = await call(testPayRoute(post({ actor: manager }), params(fc.id)));
    assert.equal(r.status, 403, key);
    assert.match(r.json.error!, /Refusing a live Stripe key/);
  }
  process.env.STRIPE_SECRET_KEY = "pk_test_abc";
  r = await call(testPayRoute(post({ actor: manager }), params(fc.id)));
  assert.equal(r.status, 403);
  assert.match(r.json.error!, /must be a test-mode key/);
  assert.equal(seen.length, 0);
  const after = FinanceCase.parse((await call(getCaseRoute(new Request("http://test"), params(fc.id)))).json);
  assert.equal(after.testPayment, undefined);
});

test("by default the CRS gate refuses an unchecked vendor, and the refusal is audited", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  const seen = fakeStripe([{ json: { id: "pi_1", status: "succeeded", livemode: false } }]);
  const fc = await released();
  let r = await call(testPayRoute(post({ actor: manager }), params(fc.id)));
  assert.equal(r.status, 409);
  assert.match(r.json.error!, /hasn't been checked with CRS/);
  assert.doesNotMatch(r.json.error!, /\.\./);
  assert.equal(seen.length, 0);

  const checked: string[] = [];
  configureFinance({ vendorRiskGate: async (vendorId) => (checked.push(vendorId), { ok: false, reason: "CRS flagged this vendor" }) });
  r = await call(testPayRoute(post({ actor: manager }), params(fc.id)));
  assert.equal(r.status, 409);
  assert.match(r.json.error!, /CRS flagged this vendor/);
  assert.deepEqual(checked, [VENUE]);

  configureFinance({ vendorRiskGate: async () => { throw new Error("CRS timeout"); } });
  r = await call(testPayRoute(post({ actor: manager }), params(fc.id)));
  assert.equal(r.status, 409);
  assert.match(r.json.error!, /Vendor check failed: CRS timeout/);

  const after = FinanceCase.parse((await call(getCaseRoute(new Request("http://test"), params(fc.id)))).json);
  assert.equal(after.testPayment, undefined);
  assert.equal(after.audit.filter((a) => /test payment for .* refused/.test(a.action)).length, 3);
  assert.equal(seen.length, 0);
});

test("happy path: one Stripe test PaymentIntent with an idempotency key; a repeat click is a no-op", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  passGate();
  const seen = fakeStripe([{ json: { id: "pi_123", status: "succeeded", livemode: false } }]);
  const fc = await released();
  let r = await call(testPayRoute(post({ actor: manager }), params(fc.id)));
  assert.equal(r.status, 200, r.json.error);
  const paid = FinanceCase.parse(r.json);
  const tp = paid.testPayment!;
  assert.equal(tp.status, "succeeded");
  assert.equal(tp.stripePaymentIntentId, "pi_123");
  assert.equal(tp.amountCents, 140000);
  assert.equal(tp.livemode, false);
  assert.equal(tp.label, STRIPE_TEST_LABEL);
  assert.equal(tp.attempts, 1);
  assert.deepEqual(tp.requestedBy, manager);
  // the product contract is untouched: the draft is still "released for manual payment", simulated
  assert.equal(paid.paymentDraft.status, "released_for_manual_payment");
  assert.equal(paid.paymentDraft.simulated, true);
  assert.ok(paid.audit.some((a) => /pi_123 succeeded .* no real money moved/.test(a.action)));

  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url, "https://api.stripe.com/v1/payment_intents");
  const headers = seen[0]!.init!.headers as Record<string, string>;
  assert.equal(headers["Idempotency-Key"], tp.idempotencyKey);
  assert.equal(headers.Authorization, "Bearer sk_test_x");
  const body = seen[0]!.init!.body as URLSearchParams;
  assert.equal(body.get("amount"), "140000");
  assert.equal(body.get("currency"), "usd");
  assert.equal(body.get("payment_method"), "pm_card_visa");
  assert.equal(body.get("transfer_data[destination]"), null); // no Connect account for a real vendor
  assert.equal(body.get("metadata[caseId]"), fc.id);

  r = await call(testPayRoute(post({ actor: manager }), params(fc.id)));
  assert.equal(r.status, 200);
  assert.deepEqual(FinanceCase.parse(r.json), paid);
  assert.equal(seen.length, 1);
});

test("a failed test payment is shown, retried once with the same idempotency key, then refused", async () => {
  process.env.STRIPE_SECRET_KEY = "rk_test_x";
  passGate();
  const seen = fakeStripe([{ status: 500, json: { error: { message: "upstream" } } }, { status: 402, json: { error: { message: "Your card was declined." } } }]);
  const fc = await released();
  let r = await call(testPayRoute(post({ actor: manager }), params(fc.id)));
  assert.equal(r.status, 502);
  assert.match(r.json.error!, /result is unknown: Stripe 500: upstream/);
  const first = FinanceCase.parse(r.json.financeCase);
  assert.equal(first.testPayment?.status, "unknown");

  r = await call(testPayRoute(post({ actor: manager }), params(fc.id)));
  assert.equal(r.status, 502);
  assert.match(r.json.error!, /failed: Stripe 402: Your card was declined/);
  const stored = FinanceCase.parse((await call(getCaseRoute(new Request("http://test"), params(fc.id)))).json);
  assert.equal(stored.testPayment?.status, "failed");
  assert.equal(stored.testPayment?.attempts, 2);

  const keys = seen.map((s) => (s.init!.headers as Record<string, string>)["Idempotency-Key"]);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);

  r = await call(testPayRoute(post({ actor: manager }), params(fc.id)));
  assert.equal(r.status, 409);
  assert.match(r.json.error!, /won't retry again/);
  assert.equal(seen.length, 2);
});

test("two clicks at once send one request", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  passGate();
  const seen = fakeStripe([{ json: { id: "pi_9", status: "succeeded", livemode: false } }]);
  const fc = await released();
  const [a, b] = await Promise.all([call(testPayRoute(post({ actor: manager }), params(fc.id))), call(testPayRoute(post({ actor: manager }), params(fc.id)))]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(seen.length, 1);
});

test("stripeTestCharge refuses live keys, network errors are 'unknown', and a livemode answer is never recorded as test", async () => {
  assert.throws(() => stripeTestCharge("sk_live_x"), /Refusing a live Stripe key/);
  assert.throws(() => stripeTestCharge("rk_live_x"), /Refusing a live Stripe key/);
  const args = { amountCents: 100, idempotencyKey: "k", description: "d", metadata: {} };
  const boom = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  assert.deepEqual((await stripeTestCharge("sk_test_x", boom)(args)).ok, false);
  assert.equal(((await stripeTestCharge("sk_test_x", boom)(args)) as { outcome: string }).outcome, "unknown");
  const live = (async () => new Response(JSON.stringify({ id: "pi_l", status: "succeeded", livemode: true }))) as unknown as typeof fetch;
  const res = await stripeTestCharge("sk_test_x", live)(args);
  assert.equal(res.ok, false);
  assert.match((res as { message: string }).message, /livemode=true/);
  const zero = await stripeTestCharge("sk_test_x", live)({ ...args, amountCents: 0 });
  assert.equal(zero.ok, false);
});

// ---------- the real research job store ----------

// The child must not inherit the parent runner's NODE_TEST_CONTEXT, or it reports to nowhere and exits 0.
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, STRIPE_SECRET_KEY: "" };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

test("against the real research job store and snapshot mapping (runs under the react-server condition)", () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "--conditions=react-server", "--test", "tests/finance/live-research.check.ts"], { encoding: "utf8", env: childEnv() });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^ℹ pass 3$/m, r.stdout);
});
