import "server-only";
import { ApifyClient } from "apify-client";
import type { Classification } from "./classify";
import { cacheKey, emitCacheHit, readCache, resolveCache, writeCache, type CacheOption } from "./cache";
import { getApifyToken, type Timeouts } from "./config";
import { newSource, type ResearchSource, type Vendor } from "./contract";
import { runTracked, type OnStatus } from "./tracked";

// Vendor discovery with Apify's Google Places crawler. Runs in parallel with
// the Bright Data work and is never on the critical path: a failure here shows
// as one failed source row, and the venue shortlist doesn't wait for it.

export const PLACES_ACTOR = "compass/crawler-google-places";

/** Actor runs take 30-90 s, so the defaults are longer than the page timeouts. */
const APIFY_TIMEOUTS: Timeouts = { softTimeoutMs: 30_000, hardTimeoutMs: 150_000, retryDelayMs: 2_000 };

export interface PlacesItem {
  title?: unknown;
  categoryName?: unknown;
  address?: unknown;
  phone?: unknown;
  website?: unknown;
  url?: unknown;
  placeId?: unknown;
  totalScore?: unknown;
  reviewsCount?: unknown;
  permanentlyClosed?: unknown;
}

/** Runs the Actor and returns its dataset items. Swappable in tests. */
export type RunPlacesActor = (input: Record<string, unknown>, signal: AbortSignal) => Promise<PlacesItem[]>;

export interface DiscoverVendorsOptions extends Partial<Timeouts> {
  /** Default "San Francisco, CA". */
  location?: string;
  /** Default 10. */
  maxPlaces?: number;
  maxAttempts?: number;
  /** Swap in a fake for tests. */
  run?: RunPlacesActor;
  /** A cache, false to skip it, or omit for the default (none when `run` is a fake). */
  cache?: CacheOption;
}

export interface DiscoverVendorsResult {
  source: ResearchSource;
  /** Empty unless source.status is "found". */
  vendors: Vendor[];
}

/** e.g. discoverVendors("quinceañera caterer", onStatus) */
export async function discoverVendors(
  query: string,
  onStatus: OnStatus,
  options: DiscoverVendorsOptions = {},
): Promise<DiscoverVendorsResult> {
  const run = options.run ?? runPlacesActor(getApifyToken());
  const cache = resolveCache(options.cache, Boolean(options.run));
  const location = options.location ?? "San Francisco, CA";
  const maxPlaces = options.maxPlaces ?? 10;
  const input = {
    searchStringsArray: [query],
    locationQuery: location,
    maxCrawledPlacesPerSearch: maxPlaces,
    language: "en",
    skipClosedPlaces: true,
  };

  // The row's URL is a readable Google Maps search, so the data-health view shows what was asked.
  const mapsSearch = `https://www.google.com/maps/search/${encodeURIComponent(`${query} ${location}`)}`;
  const source = newSource({ url: mapsSearch, provider: "apify", sourceType: "directory_listing" });

  const key = cacheKey("apify", PLACES_ACTOR, JSON.stringify(input));
  const lookupStarted = performance.now();
  const hit = await readCache<Vendor[]>(cache, key);
  if (hit) {
    const cached = await emitCacheHit(source, onStatus, hit, Math.round(performance.now() - lookupStarted));
    // Vendor records point at the source that found them, so re-point them at this row.
    return { source: cached, vendors: hit.value.map((v) => ({ ...v, sourceId: cached.id })) };
  }

  const { source: final, value } = await runTracked<Vendor[]>(
    source,
    onStatus,
    async (signal) => {
      const started = performance.now();
      const elapsed = () => Math.round(performance.now() - started);
      let items: PlacesItem[];
      try {
        items = await run(input, signal);
      } catch (err) {
        return { classification: apifyFailure(err, signal), latencyMs: elapsed() };
      }
      const vendors = toVendors(items, source.id);
      if (vendors.length === 0) {
        return { classification: { status: "empty", retryable: false, reason: "no open places matched the search" }, latencyMs: elapsed() };
      }
      return { classification: { status: "found", retryable: false }, value: vendors, latencyMs: elapsed() };
    },
    {
      softTimeoutMs: options.softTimeoutMs ?? APIFY_TIMEOUTS.softTimeoutMs,
      hardTimeoutMs: options.hardTimeoutMs ?? APIFY_TIMEOUTS.hardTimeoutMs,
      retryDelayMs: options.retryDelayMs ?? APIFY_TIMEOUTS.retryDelayMs,
      inFlightStatus: "searching",
      maxAttempts: options.maxAttempts,
    },
  );

  if (final.status === "found" && value && final.fetchedAt) {
    await writeCache(cache, key, { fetchedAt: final.fetchedAt, value });
  }
  return { source: final, vendors: value ?? [] };
}

/** Normalizes Actor items. Skips closed places and items without a name or a public link. */
export function toVendors(items: PlacesItem[], sourceId: string): Vendor[] {
  const vendors: Vendor[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const name = str(item.title);
    const mapsUrl = httpUrl(item.url);
    const website = httpUrl(item.website);
    if (!name || (!mapsUrl && !website) || item.permanentlyClosed === true) continue;

    const id = `gplace:${str(item.placeId) ?? `${name}|${str(item.address) ?? ""}`}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const rating = typeof item.totalScore === "number" ? item.totalScore : undefined;
    const reviews = typeof item.reviewsCount === "number" && Number.isInteger(item.reviewsCount) ? item.reviewsCount : undefined;
    vendors.push({
      id,
      name,
      category: str(item.categoryName),
      website,
      mapsUrl,
      address: str(item.address),
      phone: str(item.phone),
      rating,
      reviewsCount: reviews,
      sourceId,
    });
  }
  return vendors;
}

/** The real Actor call: start, wait, read the dataset. Aborting the signal aborts the run on Apify too. */
export function runPlacesActor(token: string): RunPlacesActor {
  const client = new ApifyClient({ token });
  return async (input, signal) => {
    const started = await client.actor(PLACES_ACTOR).start(input, { timeout: Math.ceil(APIFY_TIMEOUTS.hardTimeoutMs / 1000) });
    const abortRun = () => {
      client.run(started.id).abort().catch(() => {}); // stop paying for a run nobody is waiting on
    };
    signal.addEventListener("abort", abortRun, { once: true });
    try {
      const finished = await client.run(started.id).waitForFinish({ waitSecs: Math.ceil(APIFY_TIMEOUTS.hardTimeoutMs / 1000) });
      if (finished.status !== "SUCCEEDED") throw new ApifyRunError(finished.status);
      const { items } = await client.dataset(finished.defaultDatasetId).listItems({ clean: true });
      return items as PlacesItem[];
    } finally {
      signal.removeEventListener("abort", abortRun);
    }
  };
}

export class ApifyRunError extends Error {
  override name = "ApifyRunError";
  constructor(readonly runStatus: string) {
    super(`Actor run ended ${runStatus}`);
  }
}

function apifyFailure(err: unknown, signal: AbortSignal): Classification {
  if (signal.aborted) return { status: "error", retryable: true, reason: "cancelled by client timeout" };
  if (err instanceof ApifyRunError) {
    // TIMED-OUT is worth one more try; FAILED / ABORTED usually repeat.
    return { status: "error", retryable: err.runStatus === "TIMED-OUT", reason: `Apify ${err.message}` };
  }
  const status = (err as { statusCode?: unknown })?.statusCode;
  const message = err instanceof Error ? err.message : String(err);
  if (status === 401 || status === 403) return { status: "error", retryable: false, reason: `Apify rejected the token (HTTP ${status})` };
  if (status === 402) return { status: "blocked", retryable: false, reason: "Apify account is out of credit (HTTP 402)" };
  if (status === 429) return { status: "blocked", retryable: true, reason: "Apify rate limited the request (HTTP 429)" };
  if (typeof status === "number" && status >= 500) return { status: "error", retryable: true, reason: `Apify error (HTTP ${status})` };
  return { status: "error", retryable: true, reason: `Apify call failed: ${message}` };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function httpUrl(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
