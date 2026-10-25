import "server-only";
import type { Classification } from "./classify";
import { cacheKey, emitCacheHit, readCache, resolveCache, writeCache, type CacheOption } from "./cache";
import { getTimeouts, type Timeouts } from "./config";
import { newSource, type ResearchSource } from "./contract";
import { runTracked, type OnStatus } from "./tracked";

// Facility discovery from a city's public Socrata API, fetched directly.
//
// Bright Data refuses government domains by policy (proxy_error "classified as
// Government"), and open-data JSON APIs are built to be called directly. This
// returns a list of parks only, no rules: fees, lead times and alcohol policy
// still have to come from the park department's pages.

/** DataSF "RPD Parks": 222 Rec & Park properties with name, centroid and acreage. Last updated 2016. */
export const SF_PARKS_DATASET = "https://data.sf.gov/resource/3nje-yn2u.json";

export interface OpenDataPark {
  /** Stable id from the dataset (gis_fd_pk), prefixed so it can't clash with other entity ids. */
  id: string;
  name: string;
  lat?: number;
  lng?: number;
  acres?: number;
}

export interface DiscoverParksOptions extends Partial<Timeouts> {
  datasetUrl?: string;
  /** Default 500, enough for every SF park. */
  limit?: number;
  maxAttempts?: number;
  /** Swap in a fake for tests. */
  fetchFn?: typeof fetch;
  /** A cache, false to skip it, or omit for the default (none when `fetchFn` is a fake). */
  cache?: CacheOption;
}

export interface DiscoverParksResult {
  source: ResearchSource;
  /** Empty unless source.status is "found". */
  parks: OpenDataPark[];
}

export async function discoverParks(onStatus: OnStatus, options: DiscoverParksOptions = {}): Promise<DiscoverParksResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeouts = getTimeouts(options);
  const cache = resolveCache(options.cache, Boolean(options.fetchFn));

  const url = new URL(options.datasetUrl ?? SF_PARKS_DATASET);
  url.searchParams.set("$select", "map_park_n,gis_fd_pk,x,y,acres");
  url.searchParams.set("$order", "map_park_n");
  url.searchParams.set("$limit", String(options.limit ?? 500));

  const source = newSource({ url: url.toString(), provider: "open_data", sourceType: "directory_listing" });

  const key = cacheKey("open_data", source.url);
  const lookupStarted = performance.now();
  const hit = await readCache<OpenDataPark[]>(cache, key);
  if (hit) {
    const cached = await emitCacheHit(source, onStatus, hit, Math.round(performance.now() - lookupStarted));
    return { source: cached, parks: hit.value };
  }

  const { source: final, value } = await runTracked<OpenDataPark[]>(
    source,
    onStatus,
    async (signal) => {
      const started = performance.now();
      const elapsed = () => Math.round(performance.now() - started);
      let res: Response;
      let body: string;
      try {
        res = await fetchFn(source.url, { headers: { Accept: "application/json" }, signal, cache: "no-store" });
        body = await res.text();
      } catch (err) {
        if (signal.aborted) return { classification: errorOf("cancelled by client timeout", true), latencyMs: elapsed() };
        return { classification: errorOf(`network error: ${err instanceof Error ? err.message : String(err)}`, true), latencyMs: elapsed() };
      }

      const classification = classifyHttp(res.status);
      if (classification) return { classification, latencyMs: elapsed() };

      const parsed = parseParks(body);
      if ("problem" in parsed) return { classification: errorOf(parsed.problem, false), latencyMs: elapsed() };
      if (parsed.parks.length === 0) {
        return { classification: { status: "empty", retryable: false, reason: "dataset returned no parks" }, latencyMs: elapsed() };
      }
      return { classification: { status: "found", retryable: false }, value: parsed.parks, latencyMs: elapsed() };
    },
    { ...timeouts, inFlightStatus: "fetching", maxAttempts: options.maxAttempts },
  );

  if (final.status === "found" && value && final.fetchedAt) {
    await writeCache(cache, key, { fetchedAt: final.fetchedAt, value });
  }
  return { source: final, parks: value ?? [] };
}

export function parseParks(body: string): { parks: OpenDataPark[] } | { problem: string } {
  let rows: unknown;
  try {
    rows = JSON.parse(body);
  } catch {
    return { problem: "open data response wasn't JSON" };
  }
  if (!Array.isArray(rows)) return { problem: "open data response had an unexpected shape (not a list)" };

  const parks: OpenDataPark[] = [];
  const seen = new Set<string>();
  for (const row of rows as Array<Record<string, unknown>>) {
    const name = typeof row?.map_park_n === "string" ? row.map_park_n.trim() : "";
    if (!name) continue;
    const rawId = typeof row.gis_fd_pk === "string" && row.gis_fd_pk ? row.gis_fd_pk : name;
    const id = `sfrpd:${rawId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    parks.push({ id, name, lat: num(row.y), lng: num(row.x), acres: num(row.acres) });
  }
  return { parks };
}

/** Undefined for 2xx (the body decides); otherwise the failure to show. */
function classifyHttp(status: number): Classification | undefined {
  if (status >= 200 && status < 300) return undefined;
  if (status === 429) return { status: "blocked", retryable: true, reason: "open data API rate-limited the request (HTTP 429)" };
  if (status === 401 || status === 403) return { status: "blocked", retryable: false, reason: `open data API refused access (HTTP ${status})` };
  if (status >= 500) return errorOf(`open data API error (HTTP ${status})`, true);
  return errorOf(`open data API rejected the request (HTTP ${status})`, false);
}

function errorOf(reason: string, retryable: boolean): Classification {
  return { status: "error", retryable, reason };
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
