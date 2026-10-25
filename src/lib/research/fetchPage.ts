import "server-only";
import type { ResearchSource } from "./contract";
import { brightDataRequest, type BrightDataRequestFn } from "./brightdata";
import { cacheKey, emitCacheHit, readCache, resolveCache, writeCache, type CacheOption } from "./cache";
import { classifyResponse } from "./classify";
import { getBrightDataToken, getTimeouts, getZone, type Timeouts } from "./config";
import { runTracked, type OnStatus } from "./tracked";

// Layer 2: fetch one page through Web Unlocker as markdown, with status tracking.

export interface FetchPageOptions extends Partial<Timeouts> {
  /** Defaults to BRIGHTDATA_UNLOCKER_ZONE. */
  zone?: string;
  /** Capped at 2. */
  maxAttempts?: number;
  /** Pages shorter than this count as "empty". Default 100. */
  minContentChars?: number;
  /** Swap in a fake for tests. Defaults to the real Bright Data call. */
  request?: BrightDataRequestFn;
  /** A cache, false to skip it, or omit for the default (none when `request` is a fake). */
  cache?: CacheOption;
}

export interface FetchPageResult {
  /** The final state of the source, also the last thing passed to onStatus. */
  source: ResearchSource;
  /** Present only when source.status is "found". */
  markdown?: string;
}

export async function fetchPage(
  source: ResearchSource,
  onStatus: OnStatus,
  options: FetchPageOptions = {},
): Promise<FetchPageResult> {
  // Setup problems throw here, before any status is emitted.
  const request = options.request ?? brightDataRequest;
  if (!options.request) getBrightDataToken();
  const zone = options.zone ?? getZone("unlocker");
  const timeouts = getTimeouts(options);
  const cache = resolveCache(options.cache, Boolean(options.request));

  const urlProblem = checkUrl(source.url);
  if (urlProblem) {
    const failed: ResearchSource = { ...source, status: "error", error: urlProblem };
    try {
      await onStatus({ ...failed });
    } catch (err) {
      console.warn(`[research] onStatus failed for ${failed.id} (error)`, err);
    }
    return { source: failed };
  }

  const key = cacheKey("page", zone, source.url);
  const lookupStarted = performance.now();
  const hit = await readCache<string>(cache, key);
  if (hit) {
    const cached = await emitCacheHit(source, onStatus, hit, Math.round(performance.now() - lookupStarted));
    return { source: cached, markdown: hit.value };
  }

  const { source: final, value } = await runTracked(
    source,
    onStatus,
    async (signal) => {
      const res = await request({ zone, url: source.url, dataFormat: "markdown", signal });
      return {
        classification: classifyResponse(res, { minContentChars: options.minContentChars }),
        value: res.body,
        latencyMs: res.latencyMs,
      };
    },
    { ...timeouts, inFlightStatus: "fetching", maxAttempts: options.maxAttempts },
  );

  if (final.status === "found" && value !== undefined && final.fetchedAt) {
    await writeCache(cache, key, { fetchedAt: final.fetchedAt, value });
  }
  return { source: final, markdown: value };
}

function checkUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `invalid URL: ${raw}`;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return `unsupported URL scheme: ${url.protocol}`;
  }
  return undefined;
}
