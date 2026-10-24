import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResearchSource } from "../../lib/research/contract";
import { buildGoogleSearchUrl, isAllowedDomain, parseSerpHits, searchOfficialPages, SF_OFFICIAL_DOMAINS, } from "../../lib/research/search";
import { after, pageResponse, recorder, sequence } from "./helpers";
const serp = (links) => JSON.stringify({ general: { query: "q" }, organic: links.map((l, i) => ({ rank: i + 1, title: `t${i}`, ...l })) });
const fast = (request, extra = {}) => ({
    zone: "serp_test",
    softTimeoutMs: 20,
    hardTimeoutMs: 120,
    retryDelayMs: 0,
    request,
    ...extra,
});
describe("isAllowedDomain", () => {
    const allowed = SF_OFFICIAL_DOMAINS;
    for (const host of ["sf.gov", "www.sf.gov", "sfrecpark.org", "WWW.SFRECPARK.ORG", "sf.gov."]) {
        it(`allows ${host}`, () => assert.equal(isAllowedDomain(host, allowed), true));
    }
    for (const host of ["sf.gov.evil.com", "notsf.gov", "sfrecpark.org.phish.net", "yelp.com", "gov"]) {
        it(`rejects lookalike ${host}`, () => assert.equal(isAllowedDomain(host, allowed), false));
    }
});
describe("parseSerpHits", () => {
    it("keeps allowed domains only, best rank first, and drops duplicates", () => {
        const body = serp([
            { link: "https://www.yelp.com/biz/park", rank: 1 },
            { link: "https://sfrecpark.org/541/Special-Event-Application-Information", rank: 2 },
            { link: "https://sfrecpark.org/541/Special-Event-Application-Information#fees", rank: 3 },
            { link: "https://www.sf.gov/fees-for-outdoor-special-event-permitting", rank: 4 },
            { link: "javascript:alert(1)", rank: 5 },
        ]);
        const result = parseSerpHits(body, SF_OFFICIAL_DOMAINS, 5);
        assert.ok("hits" in result);
        assert.deepEqual(result.hits.map((h) => h.url), [
            "https://sfrecpark.org/541/Special-Event-Application-Information",
            "https://www.sf.gov/fees-for-outdoor-special-event-permitting",
        ]);
        assert.equal(result.totalResults, 5);
    });
    it("caps the number of hits", () => {
        const links = Array.from({ length: 8 }, (_, i) => ({ link: `https://sf.gov/page-${i}` }));
        const result = parseSerpHits(serp(links), SF_OFFICIAL_DOMAINS, 3);
        assert.ok("hits" in result);
        assert.equal(result.hits.length, 3);
        assert.equal(result.hits[0].rank, 1);
    });
    it("treats a response without organic results as zero results", () => {
        const result = parseSerpHits(JSON.stringify({ general: {} }), SF_OFFICIAL_DOMAINS, 5);
        assert.deepEqual(result, { hits: [], totalResults: 0 });
    });
    it("flags a non-JSON body", () => {
        const result = parseSerpHits("<html>google</html>", SF_OFFICIAL_DOMAINS, 5);
        assert.ok("problem" in result);
    });
});
describe("buildGoogleSearchUrl", () => {
    it("asks for parsed JSON and encodes the query", () => {
        const url = new URL(buildGoogleSearchUrl("park permit & fees"));
        assert.equal(url.searchParams.get("q"), "park permit & fees");
        assert.equal(url.searchParams.get("brd_json"), "1");
        assert.equal(url.searchParams.get("gl"), "us");
    });
});
describe("searchOfficialPages", () => {
    it("searching → found, with hits and the SERP zone", async () => {
        const rec = recorder();
        const body = serp([{ link: "https://sfrecpark.org/424/Special-Events" }]);
        const { request, calls } = sequence(after(1, pageResponse(body)));
        const { source, hits } = await searchOfficialPages("sf park special event permit", rec.onStatus, fast(request));
        assert.deepEqual(rec.statuses(), ["searching", "found"]);
        assert.equal(source.provider, "bd_serp");
        assert.equal(hits.length, 1);
        assert.equal(calls[0]?.zone, "serp_test");
        assert.equal(calls[0]?.dataFormat, undefined, "SERP uses brd_json, not markdown");
        assert.match(calls[0].url, /brd_json=1/);
        ResearchSource.parse(source);
    });
    it("ends empty, with a reason, when nothing is on an allowed domain", async () => {
        const rec = recorder();
        const body = serp([{ link: "https://www.yelp.com/a" }, { link: "https://www.reddit.com/b" }]);
        const { request, calls } = sequence(after(1, pageResponse(body)));
        const { source, hits } = await searchOfficialPages("anything", rec.onStatus, fast(request));
        assert.deepEqual(rec.statuses(), ["searching", "empty"]);
        assert.equal(calls.length, 1, "an empty search isn't retried");
        assert.equal(hits.length, 0);
        assert.match(source.error, /none of the 2 results/);
    });
    it("reports a non-JSON response as an error, without retrying", async () => {
        const { request, calls } = sequence(after(1, pageResponse("<html>not json</html>")));
        const { source } = await searchOfficialPages("anything", () => { }, fast(request));
        assert.equal(source.status, "error");
        assert.equal(calls.length, 1);
        assert.match(source.error, /wasn't JSON/);
    });
});
