import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CrsClient, resetCrsLoginLatch } from "../src/lib/crs/client";
import { parseBusinessCredit, parseBusinessSearch, parseOfac, type CheckOutcome, type CreditData, type OfacData, type SearchData } from "../src/lib/crs/checks";
import { decideRisk, namesMatch, parseCrsDate } from "../src/lib/crs/rules";
import { checkVendorRisk } from "../src/lib/crs/service";
import { clearRiskStore, getRisk, saveRisk } from "../src/lib/crs/store";
import { vendorRiskGate } from "../src/lib/crs/gate";
import { VendorRisk } from "../src/mela/contracts";

// All fakes, no network. Response shapes follow CRS's published OpenAPI.

type Call = { url: string; init: RequestInit; body: unknown };

function fakeFetch(handler: (path: string, body: unknown, call: number) => Response | Promise<Response> | "hang") {
  const calls: Call[] = [];
  const fn = (async (url: string | URL, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), init, body });
    const path = String(url).replace("https://crs.test/api", "");
    const r = await handler(path, body, calls.length);
    if (r === "hang") {
      return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }
    return r;
  }) as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const LOGIN = json(200, { token: "tok-1", expires: 0, refreshToken: "r" });

function client(fetchFn: typeof fetch, logs: string[] = []) {
  return new CrsClient({
    baseUrl: "https://crs.test/api",
    username: "u",
    password: "p",
    fetch: fetchFn,
    timeoutMs: 30,
    retryDelayMs: 0,
    sleep: async () => {},
    log: (l) => logs.push(l),
  });
}

beforeEach(() => {
  resetCrsLoginLatch();
  clearRiskStore();
});

// ---------- transport ----------

test("logs in once, reuses the bearer token, reads RequestID", async () => {
  const f = fakeFetch((path) => (path === "/users/login" ? LOGIN.clone() : json(200, { data: [] }, { RequestID: "req-9" })));
  const c = client(f.fn);
  const a = await c.post("/ccc/exp/search", { name: "X" }, "t");
  const b = await c.post("/ccc/exp/search", { name: "Y" }, "t");
  assert.equal(a.ok && a.requestId, "req-9");
  assert.ok(b.ok);
  assert.equal(f.calls.filter((x) => x.url.endsWith("/users/login")).length, 1);
  const product = f.calls.find((x) => x.url.endsWith("/ccc/exp/search"))!;
  assert.equal((product.init.headers as Record<string, string>).Authorization, "Bearer tok-1");
  assert.deepEqual(f.calls[0]!.body, { username: "u", password: "p" });
});

test("retries a 503 once and stops at 2 attempts", async () => {
  const f = fakeFetch((path) => (path === "/users/login" ? LOGIN.clone() : json(503, { codes: ["CRS702"], messages: ["PitchPoint Service Unavailable"] })));
  const r = await client(f.fn).post("/ccc/exp/score", { bin: "1" }, "t");
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 2);
  assert.equal(f.calls.filter((x) => x.url.endsWith("/ccc/exp/score")).length, 2);
  assert.match(!r.ok ? r.message : "", /unavailable.*Tried 2 times/);
});

test("503 then 200 succeeds on the second attempt", async () => {
  const f = fakeFetch((path, _b, n) => (path === "/users/login" ? LOGIN.clone() : n === 2 ? json(503, {}) : json(200, { data: [] })));
  const r = await client(f.fn).post("/ccc/exp/search", {}, "t");
  assert.ok(r.ok);
  assert.equal(r.attempts, 2);
});

test("a hung request times out, twice at most", async () => {
  const f = fakeFetch((path) => (path === "/users/login" ? LOGIN.clone() : "hang"));
  const r = await client(f.fn).post("/ccc/exp/search", {}, "t");
  assert.equal(!r.ok && r.kind, "timeout");
  assert.equal(r.attempts, 2);
});

test("a 400 is not retried and keeps the CRS code", async () => {
  const f = fakeFetch((path) => (path === "/users/login" ? LOGIN.clone() : json(400, { codes: ["CRS200"], messages: ["Invalid request fields"] })));
  const r = await client(f.fn).post("/ccc/exp/search", {}, "t");
  assert.equal(!r.ok && r.kind, "refused");
  assert.equal(r.attempts, 1);
  assert.match(!r.ok ? r.message : "", /CRS200/);
});

test("a failed login is latched: no second login attempt", async () => {
  const f = fakeFetch(() => json(401, { messages: ["bad credentials"] }));
  const c = client(f.fn);
  const a = await c.post("/ccc/exp/search", {}, "t");
  const b = await client(f.fn).post("/ccc/exp/search", {}, "t");
  assert.equal(!a.ok && a.kind, "auth");
  assert.equal(!b.ok && b.kind, "auth");
  assert.equal(f.calls.length, 1);
});

test("401 on a product re-logs in once, then reports no access", async () => {
  const f = fakeFetch((path) => (path === "/users/login" ? LOGIN.clone() : json(401, {})));
  const r = await client(f.fn).post("/xgs/search/cfg", {}, "t");
  assert.equal(!r.ok && r.kind, "auth");
  assert.equal(f.calls.filter((x) => x.url.endsWith("/users/login")).length, 2);
  assert.ok(r.attempts <= 2);
});

// ---------- parsers ----------

test("business search picks the most reliable hit; empty data is no match; missing data is an error", () => {
  const p = parseBusinessSearch({
    data: [
      { bin: "1", businessName: "A", reliabilityCode: 50, numberOfTradelines: 4, address: { city: "SF", state: "CA" } },
      { bin: "2", businessName: "B", reliabilityCode: 90, numberOfTradelines: 9 },
    ],
  });
  assert.equal(p.kind === "hits" && p.data.hit.bin, "2");
  assert.equal(p.kind === "hits" && p.data.hitCount, 2);
  assert.equal(parseBusinessSearch({ data: [] }).kind, "none");
  assert.equal(parseBusinessSearch({ result: "x" }).kind, "bad");
});

test("credit parser keeps only executive elements it needs", () => {
  const p = parseBusinessCredit({
    data: { executiveElements: { judgmentCount: 2, taxId: "12-3456789", bankruptcyIndicator: false }, businessNameAndAddress: [{ fileEstablishDate: "2019-04-01" }] },
  });
  assert.equal(p.kind, "ok");
  if (p.kind === "ok") {
    assert.equal(p.data.judgmentCount, 2);
    assert.equal(p.data.fileEstablishDate, "2019-04-01");
    assert.equal("taxId" in p.data, false);
  }
  assert.equal(parseBusinessCredit({ data: {} }).kind, "bad");
});

test("OFAC parser: NOT_SEARCHED is an error, false positives are dismissed", () => {
  assert.equal(parseOfac({ records: { resultRecord: [{ watchlist: { status: "NOT_SEARCHED" } }] } }).kind, "bad");
  const p = parseOfac({
    records: {
      resultRecord: [
        {
          watchlist: {
            status: "RESULTS",
            matches: { wlmatch: [{ entityName: "BAD CO", entityScore: 97, file: { name: "SDN" } }, { entityName: "OK", falsePositive: true }] },
          },
        },
      ],
    },
  });
  assert.equal(p.kind === "ok" && p.data.matches.length, 1);
  assert.equal(p.kind === "ok" && p.data.dismissed, 1);
});

// ---------- rules ----------

const NOW = new Date("2026-10-24T12:00:00Z");
const okSearch = (over: Partial<SearchData["hit"]> = {}): CheckOutcome<SearchData> => ({
  status: "ok",
  data: { hit: { bin: "963129279", businessName: "Cocina Abuela LLC", reliabilityCode: 90, numberOfTradelines: 12, city: "SAN FRANCISCO", state: "CA", ...over }, hitCount: 1 },
  requestId: "s1",
  latencyMs: 5,
  attempts: 1,
});
const okCredit = (over: Partial<CreditData> = {}): CheckOutcome<CreditData> => ({
  status: "ok",
  data: { bankruptcyIndicator: false, bankruptcyCount: 0, judgmentCount: 0, taxLienCount: 0, fileEstablishDate: "2019-03-01", ...over },
  requestId: "c1",
  latencyMs: 5,
  attempts: 1,
});
const okOfac = (over: Partial<OfacData> = {}): CheckOutcome<OfacData> => ({
  status: "ok",
  data: { watchlistStatus: "NO_RESULTS", matches: [], dismissed: 0, ...over },
  requestId: "o1",
  latencyMs: 5,
  attempts: 1,
});
const decide = (search = okSearch(), credit = okCredit(), ofac = okOfac()) =>
  decideRisk({ vendorId: "v1", searchedName: "Cocina Abuela", search, credit, ofac, now: NOW });

test("clean business → clear, every reason cites a CRS field, result fits the contract", () => {
  const r = decide();
  assert.equal(r.status, "checked");
  assert.equal(r.level, "clear");
  assert.ok(r.reasons.length >= 3);
  for (const reason of r.reasons) {
    assert.equal(reason.severity, "info");
    assert.ok(reason.source.field.length > 0);
  }
  assert.equal(r.business?.onFileSince, "2019-03-01");
  assert.equal(r.freshUntil, "2026-10-31T12:00:00.000Z");
  VendorRisk.parse(r);
});

test("OFAC match → block, citing the watchlist entry", () => {
  const r = decide(okSearch(), okCredit(), okOfac({ watchlistStatus: "RESULTS", matches: [{ entityName: "COCINA ABUELA", listName: "SDN", entityScore: 95 }] }));
  assert.equal(r.level, "block");
  const b = r.reasons.find((x) => x.code === "ofac_match")!;
  assert.equal(b.source.check, "ofac");
  assert.match(b.source.field, /watchlist\.matches\.wlmatch\[0\]\.entityName/);
  assert.equal(b.source.requestId, "o1");
});

test("only false-positive watchlist hits → not blocked", () => {
  const r = decide(okSearch(), okCredit(), okOfac({ watchlistStatus: "RESULTS", matches: [], dismissed: 2 }));
  assert.equal(r.level, "clear");
});

test("recent or undated bankruptcy → block; older than 24 months → review", () => {
  assert.equal(decide(okSearch(), okCredit({ bankruptcyCount: 1, mostRecentBankruptcyDate: "2026-01-15" })).level, "block");
  assert.equal(decide(okSearch(), okCredit({ bankruptcyIndicator: true, bankruptcyCount: undefined })).level, "block");
  const old = decide(okSearch(), okCredit({ bankruptcyCount: 1, mostRecentBankruptcyDate: "2019-06-01" }));
  assert.equal(old.level, "review");
  assert.equal(old.reasons.find((x) => x.code === "bankruptcy_past")?.source.field, "data.executiveElements.bankruptcyCount");
});

test("no such business → review (not block), credit skipped, still a finished check", () => {
  const r = decide({ status: "no_match", latencyMs: 1, attempts: 1, requestId: "s0" }, { status: "skipped", detail: "no BIN" });
  assert.equal(r.status, "checked");
  assert.equal(r.level, "review");
  assert.equal(r.reasons.find((x) => x.code === "no_business_found")?.source.field, "data");
});

test("name mismatch, thin file, judgments, tax liens → review with fields", () => {
  const cases: [CheckOutcome<SearchData>, CheckOutcome<CreditData>, string, string][] = [
    [okSearch({ businessName: "Golden Gate Plumbing Inc" }), okCredit(), "name_mismatch", "data[].businessName"],
    [okSearch({ numberOfTradelines: 1 }), okCredit(), "thin_file", "data[].numberOfTradelines"],
    [okSearch(), okCredit({ judgmentCount: 1, judgmentBalance: 12000, mostRecentJudgmentDate: "2025-02-01" }), "judgments_on_file", "data.executiveElements.judgmentCount"],
    [okSearch(), okCredit({ taxLienCount: 2 }), "tax_liens_on_file", "data.executiveElements.taxLienCount"],
  ];
  for (const [s, c, code, field] of cases) {
    const r = decide(s, c);
    assert.equal(r.level, "review", code);
    assert.equal(r.reasons.find((x) => x.code === code)?.source.field, field, code);
  }
});

test("a failed or unconfigured check → not_checked, never clear", () => {
  const err = decide(okSearch(), okCredit(), { status: "error", detail: "CRS didn't answer within 15 s.", latencyMs: 15000, attempts: 2 });
  assert.equal(err.status, "not_checked");
  assert.equal(err.level, null);
  assert.match(err.notCheckedReason ?? "", /OFAC screen: CRS didn't answer/);
  const unconfigured = decide(okSearch(), okCredit(), { status: "not_configured", detail: "OFAC screening isn't set up" });
  assert.equal(unconfigured.status, "not_checked");
  const searchDown = decide({ status: "error", detail: "503", latencyMs: 1, attempts: 2 }, { status: "skipped", detail: "x" });
  assert.equal(searchDown.level, null);
  VendorRisk.parse(err);
});

test("a definite block stands even if another check failed", () => {
  const r = decide(okSearch(), { status: "error", detail: "timeout", latencyMs: 1, attempts: 2 }, okOfac({ watchlistStatus: "RESULTS", matches: [{ entityName: "X" }] }));
  assert.equal(r.status, "checked");
  assert.equal(r.level, "block");
});

test("name matching ignores suffixes and punctuation", () => {
  assert.ok(namesMatch("Cocina Abuela", "COCINA ABUELA, LLC"));
  assert.ok(namesMatch("Joe's Catering & Events", "JOES CATERING AND EVENTS INC"));
  assert.ok(namesMatch("Lakeview Loft", "The Lakeview Loft Event Space"));
  assert.ok(!namesMatch("Lakeview Loft", "Golden Gate Plumbing"));
  assert.ok(!namesMatch("LLC", "Anything"));
});

test("CRS dates: ISO, US and compact; junk is undefined", () => {
  assert.equal(parseCrsDate("2024-03-01")?.toISOString().slice(0, 10), "2024-03-01");
  assert.equal(parseCrsDate("03/01/2024")?.toISOString().slice(0, 10), "2024-03-01");
  assert.equal(parseCrsDate("20240301")?.toISOString().slice(0, 10), "2024-03-01");
  assert.equal(parseCrsDate("last spring"), undefined);
});

// ---------- gate ----------

test("gate: ok only for a fresh, checked, clear result", async () => {
  assert.equal((await vendorRiskGate("v1")).ok, false);
  saveRisk(decide());
  const now = NOW.getTime();
  assert.deepEqual(await vendorRiskGate("v1", now), { ok: true });
  const stale = await vendorRiskGate("v1", now + 8 * 86_400_000);
  assert.equal(stale.ok, false);
  assert.match(!stale.ok ? stale.reason : "", /more than 7 days/);

  saveRisk(decide(okSearch({ numberOfTradelines: 0 })));
  const review = await vendorRiskGate("v1", now);
  assert.match(!review.ok ? review.reason : "", /review.*Thin credit file/);

  saveRisk(decide(okSearch(), okCredit(), { status: "error", detail: "CRS login failed (401).", latencyMs: 1, attempts: 1 }));
  const nc = await vendorRiskGate("v1", now);
  assert.match(!nc.ok ? nc.reason : "", /didn't finish.*login failed/);

  saveRisk(decide(okSearch(), okCredit({ bankruptcyCount: 1 })));
  const blocked = await vendorRiskGate("v1", now);
  assert.match(!blocked.ok ? blocked.reason : "", /blocks payment.*Bankruptcy/);
});

// ---------- end to end over the fake transport ----------

const SEARCH_OK = { data: [{ bin: "963129279", businessName: "COCINA ABUELA LLC", reliabilityCode: 90, numberOfTradelines: 8, address: { city: "SAN FRANCISCO", state: "CA" } }] };
const SCORE_OK = { data: { executiveElements: { bankruptcyCount: 0, judgmentCount: 0, taxLienCount: 0, yearOfIncorporation: "2018" } } };
const OFAC_OK = { records: { resultRecord: [{ watchlist: { status: "NO_RESULTS" } }] } };
const OFAC_CFG = { config: "bridger-test", glbPurpose: "1", dlPurpose: "0" };

test("full check sends business fields only, runs score with the BIN, saves the result, logs no names", async () => {
  const logs: string[] = [];
  const f = fakeFetch((path) => {
    if (path === "/users/login") return LOGIN.clone();
    if (path === "/ccc/exp/search") return json(200, SEARCH_OK, { RequestID: "rq-s" });
    if (path === "/ccc/exp/score") return json(200, SCORE_OK, { RequestID: "rq-c" });
    if (path === "/xgs/search/bridger-test") return json(200, OFAC_OK, { RequestID: "rq-o" });
    return json(404, {});
  });
  const risk = await checkVendorRisk(
    "v9",
    { name: "Cocina Abuela", city: "San Francisco", state: "CA", phone: "+14155550100" },
    { client: client(f.fn, logs), ofac: OFAC_CFG, now: () => NOW },
  );
  assert.equal(risk.level, "clear");
  assert.equal(getRisk("v9")?.level, "clear");
  assert.deepEqual(risk.checks.map((c) => [c.check, c.status, c.requestId]), [
    ["business_search", "ok", "rq-s"],
    ["business_credit", "ok", "rq-c"],
    ["ofac", "ok", "rq-o"],
  ]);

  const search = f.calls.find((c) => c.url.endsWith("/ccc/exp/search"))!.body as Record<string, string>;
  assert.deepEqual(Object.keys(search).sort(), ["city", "name", "phone", "state"]);
  assert.deepEqual(f.calls.find((c) => c.url.endsWith("/ccc/exp/score"))!.body, { bin: "963129279" });
  const ofac = f.calls.find((c) => c.url.includes("/xgs/search/"))!.body as {
    input: { records: { inputRecord: { entity: { entityType: string; name: { full: string } } }[] } };
  };
  assert.equal(ofac.input.records.inputRecord[0].entity.entityType, "BUSINESS");
  assert.equal(ofac.input.records.inputRecord[0].entity.name.full, "Cocina Abuela");

  const everything = JSON.stringify(f.calls.map((c) => c.body));
  assert.doesNotMatch(everything, /ssn|dob|birthDate|firstName|lastName/i);
  assert.ok(logs.length > 0);
  for (const l of logs) assert.doesNotMatch(l, /Cocina|COCINA|963129279/);
});

test("no OFAC config → not_checked even when everything else is clean", async () => {
  const f = fakeFetch((path) => (path === "/users/login" ? LOGIN.clone() : path === "/ccc/exp/search" ? json(200, SEARCH_OK) : json(200, SCORE_OK)));
  const risk = await checkVendorRisk("v10", { name: "Cocina Abuela" }, { client: client(f.fn), ofac: null, now: () => NOW });
  assert.equal(risk.status, "not_checked");
  assert.equal(risk.level, null);
  assert.equal(risk.checks.find((c) => c.check === "ofac")?.status, "not_configured");
  assert.equal(f.calls.some((c) => c.url.includes("/xgs/")), false);
  assert.equal((await vendorRiskGate("v10")).ok, false);
});

test("CRS down → not_checked with the reason, gate refuses", async () => {
  const f = fakeFetch((path) => (path === "/users/login" ? LOGIN.clone() : json(503, {})));
  const risk = await checkVendorRisk("v11", { name: "Cocina Abuela" }, { client: client(f.fn), ofac: OFAC_CFG, now: () => NOW });
  assert.equal(risk.status, "not_checked");
  assert.match(risk.notCheckedReason ?? "", /unavailable/);
  assert.equal(risk.checks.find((c) => c.check === "business_credit")?.status, "skipped");
  // 2 attempts each for search and OFAC, none for score.
  assert.equal(f.calls.filter((c) => !c.url.endsWith("/users/login")).length, 4);
});

// ---------- guardrail: no consumer products ----------

test("the CRS module never calls consumer credit, criminal, eviction or consumer identity routes", () => {
  const dir = "src/lib/crs";
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), "utf8");
    assert.doesNotMatch(src, /["'`]\/(transunion|equifax|experian)\/|\/criminal\/|\/eviction\/|\/pp\/fcrablj|identity-manager|fraud-finder|accurate-append|instant-id/, f);
  }
});
