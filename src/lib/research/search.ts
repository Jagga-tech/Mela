import "server-only";
import { newSource, type ResearchSource, type SourceType } from "./contract";
import { brightDataRequest, type BrightDataRequestFn } from "./brightdata";
import { cacheKey, emitCacheHit, readCache, resolveCache, writeCache, type CacheOption } from "./cache";
import { classifyResponse } from "./classify";
import { getBrightDataToken, getTimeouts, getZone, type Timeouts } from "./config";
import { runTracked, type OnStatus } from "./tracked";

// Layer 3: find official pages with Bright Data's SERP API.
//
// Whether a result counts as official is decided by its domain, in code,
// every time. The LLM never decides what is official.

/** Domains whose pages count as official San Francisco sources. Extend deliberately. */
export const SF_OFFICIAL_DOMAINS = ["sfrecpark.org", "sf.gov", "sfgov.org"] as const;

export interface SearchHit {
  url: string;
  title: string;
  description?: string;
  /** Position in Google's organic results (1 = top). */
  rank: number;
  domain: string;
}

export interface SearchOptions extends Partial<Timeouts> {
  /** Only results on these domains (or their subdomains) are kept, or "any". Default: SF_OFFICIAL_DOMAINS. */
  allowedDomains?: readonly string[] | "any";
  /** Results on these domains (or their subdomains) are dropped, e.g. directories when looking for venues' own sites. */
  excludedDomains?: readonly string[];
  /** Default 5. */
  maxResults?: number;
  /** Recorded on the search's own source row. Default "official_city". */
  sourceType?: SourceType;
  /** Defaults to BRIGHTDATA_SERP_ZONE. */
  zone?: string;
  country?: string; // Google gl, default "us"
  language?: string; // Google hl, default "en"
  maxAttempts?: number;
  /** Swap in a fake for tests. */
  request?: BrightDataRequestFn;
  /** A cache, false to skip it, or omit for the default (none when `request` is a fake). */
  cache?: CacheOption;
}

export interface SearchResult {
  /** The search itself is a source, so a failed search shows on the dashboard too. */
  source: ResearchSource;
  /** Allowed hits, best first. Empty unless source.status is "found". */
  hits: SearchHit[];
}

export async function searchOfficialPages(
  query: string,
  onStatus: OnStatus,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const request = options.request ?? brightDataRequest;
  if (!options.request) getBrightDataToken();
  const zone = options.zone ?? getZone("serp");
  const timeouts = getTimeouts(options);
  const rawAllowed = options.allowedDomains ?? SF_OFFICIAL_DOMAINS;
  const allowed = rawAllowed === "any" ? null : rawAllowed.map((d) => d.toLowerCase());
  const excluded = (options.excludedDomains ?? []).map((d) => d.toLowerCase());
  const maxResults = options.maxResults ?? 5;
  const cache = resolveCache(options.cache, Boolean(options.request));

  const searchUrl = buildGoogleSearchUrl(query, options);
  const source = newSource({ url: searchUrl, provider: "bd_serp", sourceType: options.sourceType ?? "official_city" });

  // The hits depend on the filter too, so it's part of the key.
  const key = cacheKey("serp", zone, searchUrl, allowed?.join(",") ?? "any", excluded.join(","), String(maxResults));
  const lookupStarted = performance.now();
  const hit = await readCache<SearchHit[]>(cache, key);
  if (hit) {
    const cached = await emitCacheHit(source, onStatus, hit, Math.round(performance.now() - lookupStarted));
    return { source: cached, hits: hit.value };
  }

  const { source: final, value } = await runTracked<SearchHit[]>(
    source,
    onStatus,
    async (signal) => {
      const res = await request({ zone, url: searchUrl, signal });
      const classification = classifyResponse(res, { minContentChars: 1 });
      if (classification.status !== "found") {
        return { classification, latencyMs: res.latencyMs };
      }

      const parsed = parseSerpHits(res.body ?? "", allowed, maxResults, excluded);
      if ("problem" in parsed) {
        return {
          classification: { status: "error", retryable: false, reason: parsed.problem },
          latencyMs: res.latencyMs,
        };
      }
      if (parsed.hits.length === 0) {
        const reason =
          parsed.totalResults === 0
            ? "search returned no results"
            : allowed
              ? `none of the ${parsed.totalResults} results are on an allowed domain (${allowed.join(", ")})`
              : `all ${parsed.totalResults} results are directory or excluded sites`;
        return { classification: { status: "empty", retryable: false, reason }, latencyMs: res.latencyMs };
      }
      return { classification, value: parsed.hits, latencyMs: res.latencyMs };
    },
    { ...timeouts, inFlightStatus: "searching", maxAttempts: options.maxAttempts },
  );

  if (final.status === "found" && value && final.fetchedAt) {
    await writeCache(cache, key, { fetchedAt: final.fetchedAt, value });
  }
  return { source: final, hits: value ?? [] };
}

export function buildGoogleSearchUrl(
  query: string,
  opts: { country?: string; language?: string } = {},
): string {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("gl", opts.country ?? "us");
  url.searchParams.set("hl", opts.language ?? "en");
  url.searchParams.set("brd_json", "1"); // parsed JSON instead of HTML
  return url.toString();
}

/** Exact domain or a subdomain of it. "sf.gov.evil.com" and "notsf.gov" don't match "sf.gov". */
export function isAllowedDomain(hostname: string, allowed: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowed.some((d) => host === d || host.endsWith(`.${d}`));
}

interface RawOrganic {
  link?: unknown;
  title?: unknown;
  description?: unknown;
  rank?: unknown;
}

export function parseSerpHits(
  body: string,
  allowed: readonly string[] | null,
  maxResults: number,
  excluded: readonly string[] = [],
): { hits: SearchHit[]; totalResults: number } | { problem: string } {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { problem: "SERP response wasn't JSON. Check that the zone is a SERP API zone." };
  }
  const organic = (data as { organic?: unknown })?.organic;
  if (organic === undefined) return { hits: [], totalResults: 0 };
  if (!Array.isArray(organic)) return { problem: "SERP response had an unexpected shape (organic is not a list)." };

  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  organic.forEach((item: RawOrganic, index) => {
    if (typeof item?.link !== "string") return;
    let url: URL;
    try {
      url = new URL(item.link);
    } catch {
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    if (allowed && !isAllowedDomain(url.hostname, allowed)) return;
    if (isAllowedDomain(url.hostname, excluded)) return;

    url.hash = "";
    const key = url.toString();
    if (seen.has(key)) return;
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
