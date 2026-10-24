import "server-only";
import { newSource } from "./contract";
import { brightDataRequest } from "./brightdata";
import { classifyResponse } from "./classify";
import { getBrightDataToken, getTimeouts, getZone } from "./config";
import { runTracked } from "./tracked";
// Layer 3: find official pages with Bright Data's SERP API.
//
// Whether a result counts as official is decided by its domain, in code,
// every time. The LLM never decides what is official.
/** Domains whose pages count as official San Francisco sources. Extend deliberately. */
export const SF_OFFICIAL_DOMAINS = ["sfrecpark.org", "sf.gov", "sfgov.org"];
export async function searchOfficialPages(query, onStatus, options = {}) {
    const request = options.request ?? brightDataRequest;
    if (!options.request)
        getBrightDataToken();
    const zone = options.zone ?? getZone("serp");
    const timeouts = getTimeouts(options);
    const allowed = (options.allowedDomains ?? SF_OFFICIAL_DOMAINS).map((d) => d.toLowerCase());
    const maxResults = options.maxResults ?? 5;
    const searchUrl = buildGoogleSearchUrl(query, options);
    const source = newSource({ url: searchUrl, provider: "bd_serp", sourceType: options.sourceType ?? "official_city" });
    const { source: final, value } = await runTracked(source, onStatus, async (signal) => {
        const res = await request({ zone, url: searchUrl, signal });
        const classification = classifyResponse(res, { minContentChars: 1 });
        if (classification.status !== "found") {
            return { classification, latencyMs: res.latencyMs };
        }
        const parsed = parseSerpHits(res.body ?? "", allowed, maxResults);
        if ("problem" in parsed) {
            return {
                classification: { status: "error", retryable: false, reason: parsed.problem },
                latencyMs: res.latencyMs,
            };
        }
        if (parsed.hits.length === 0) {
            const reason = parsed.totalResults === 0
                ? "search returned no results"
                : `none of the ${parsed.totalResults} results are on an allowed domain (${allowed.join(", ")})`;
            return { classification: { status: "empty", retryable: false, reason }, latencyMs: res.latencyMs };
        }
        return { classification, value: parsed.hits, latencyMs: res.latencyMs };
    }, { ...timeouts, inFlightStatus: "searching", maxAttempts: options.maxAttempts });
    return { source: final, hits: value ?? [] };
}
export function buildGoogleSearchUrl(query, opts = {}) {
    const url = new URL("https://www.google.com/search");
    url.searchParams.set("q", query);
    url.searchParams.set("gl", opts.country ?? "us");
    url.searchParams.set("hl", opts.language ?? "en");
    url.searchParams.set("brd_json", "1"); // parsed JSON instead of HTML
    return url.toString();
}
/** Exact domain or a subdomain of it. "sf.gov.evil.com" and "notsf.gov" don't match "sf.gov". */
export function isAllowedDomain(hostname, allowed) {
    const host = hostname.toLowerCase().replace(/\.$/, "");
    return allowed.some((d) => host === d || host.endsWith(`.${d}`));
}
export function parseSerpHits(body, allowed, maxResults) {
    let data;
    try {
        data = JSON.parse(body);
    }
    catch {
        return { problem: "SERP response wasn't JSON. Check that the zone is a SERP API zone." };
    }
    const organic = data?.organic;
    if (organic === undefined)
        return { hits: [], totalResults: 0 };
    if (!Array.isArray(organic))
        return { problem: "SERP response had an unexpected shape (organic is not a list)." };
    const hits = [];
    const seen = new Set();
    organic.forEach((item, index) => {
        if (typeof item?.link !== "string")
            return;
        let url;
        try {
            url = new URL(item.link);
        }
        catch {
            return;
        }
        if (url.protocol !== "https:" && url.protocol !== "http:")
            return;
        if (!isAllowedDomain(url.hostname, allowed))
            return;
        url.hash = "";
        const key = url.toString();
        if (seen.has(key))
            return;
        seen.add(key);
        hits.push({
            url: key,
            title: typeof item.title === "string" ? item.title : key,
            description: typeof item.description === "string" ? item.description : undefined,
            rank: typeof item.rank === "number" ? item.rank : index + 1,
            domain: url.hostname.toLowerCase(),
        });
    });
    hits.sort((a, b) => a.rank - b.rank);
    return { hits: hits.slice(0, maxResults), totalResults: organic.length };
}
