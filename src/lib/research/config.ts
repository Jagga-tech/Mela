import "server-only";

// Every environment variable the research module reads is read here, and only
// on the server. A missing variable is a setup bug, not a source failure, so it
// throws instead of turning into an "error" row on the dashboard.

export class ConfigError extends Error {
  override name = "ConfigError";
}

export interface Timeouts {
  /** After this long without a response, the source shows "slow" but keeps going. */
  softTimeoutMs: number;
  /** After this long, the attempt is cancelled and counts as an error. */
  hardTimeoutMs: number;
  /** Pause before the second (and last) attempt. */
  retryDelayMs: number;
}

const DEFAULT_TIMEOUTS: Timeouts = {
  softTimeoutMs: 8_000,
  hardTimeoutMs: 25_000,
  retryDelayMs: 1_000,
};

/** The team plan names BRIGHTDATA_API_TOKEN; the Bright Data kit uses BRIGHTDATA_API_KEY. Either works. */
export function getBrightDataToken(): string {
  const token = process.env.BRIGHTDATA_API_TOKEN ?? process.env.BRIGHTDATA_API_KEY;
  if (!token) {
    throw new ConfigError("BRIGHTDATA_API_TOKEN is not set (BRIGHTDATA_API_KEY also accepted).");
  }
  return token;
}

export type ZoneKind = "unlocker" | "serp";

const ZONE_ENV: Record<ZoneKind, string> = {
  unlocker: "BRIGHTDATA_UNLOCKER_ZONE",
  serp: "BRIGHTDATA_SERP_ZONE",
};

export function getZone(kind: ZoneKind): string {
  const name = ZONE_ENV[kind];
  const zone = process.env[name];
  if (!zone) {
    throw new ConfigError(`${name} is not set. Find your zone names at brightdata.com/cp/zones.`);
  }
  return zone;
}

/** Defaults, overridable with RESEARCH_SOFT_TIMEOUT_MS / RESEARCH_HARD_TIMEOUT_MS / RESEARCH_RETRY_DELAY_MS. */
export function getTimeouts(overrides: Partial<Timeouts> = {}): Timeouts {
  const t: Timeouts = {
    softTimeoutMs: overrides.softTimeoutMs ?? readMs("RESEARCH_SOFT_TIMEOUT_MS", DEFAULT_TIMEOUTS.softTimeoutMs),
    hardTimeoutMs: overrides.hardTimeoutMs ?? readMs("RESEARCH_HARD_TIMEOUT_MS", DEFAULT_TIMEOUTS.hardTimeoutMs),
    retryDelayMs: overrides.retryDelayMs ?? readMs("RESEARCH_RETRY_DELAY_MS", DEFAULT_TIMEOUTS.retryDelayMs),
  };
  if (t.softTimeoutMs >= t.hardTimeoutMs) {
    throw new ConfigError(
      `Soft timeout (${t.softTimeoutMs} ms) must be shorter than the hard timeout (${t.hardTimeoutMs} ms).`,
    );
  }
  return t;
}

export interface ExtractSettings {
  model: string;
  /** Per extraction call. The SDK retries once on 429/5xx, so wall-clock can reach twice this. */
  timeoutMs: number;
}

/**
 * The Anthropic SDK reads ANTHROPIC_API_KEY itself. RESEARCH_LLM_MODEL overrides the
 * model (default claude-opus-5-5); RESEARCH_EXTRACT_TIMEOUT_MS the timeout (default 60 s).
 */
export function getExtractSettings(): ExtractSettings {
  return {
    model: process.env.RESEARCH_LLM_MODEL || "claude-opus-5-5",
    timeoutMs: readMs("RESEARCH_EXTRACT_TIMEOUT_MS", 60_000),
  };
}

export function getApifyToken(): string {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new ConfigError("APIFY_TOKEN is not set. Find it at console.apify.com/settings/integrations.");
  return token;
}

export interface CacheSettings {
  enabled: boolean;
  dir: string;
  ttlMs: number;
}

/**
 * RESEARCH_CACHE=off disables the cache (required for the ablation test).
 * RESEARCH_CACHE_DIR (default .research-cache, or /tmp/research-cache on Vercel) and
 * RESEARCH_CACHE_TTL_MS (default 24 h).
 */
export function getCacheSettings(): CacheSettings {
  const raw = (process.env.RESEARCH_CACHE ?? "on").trim().toLowerCase();
  if (raw !== "on" && raw !== "off") {
    throw new ConfigError(`RESEARCH_CACHE must be "on" or "off", got "${process.env.RESEARCH_CACHE}".`);
  }
  return {
    enabled: raw === "on",
    // On Vercel only /tmp is writable (and it's per-instance, so treat it as best-effort).
    dir: process.env.RESEARCH_CACHE_DIR || (process.env.VERCEL ? "/tmp/research-cache" : ".research-cache"),
    ttlMs: readMs("RESEARCH_CACHE_TTL_MS", 24 * 60 * 60 * 1000),
  };
}

/**
 * Call once at server startup (or at the top of the research job) to fail fast
 * on missing configuration, before any source rows are created.
 */
export function checkResearchConfig(opts: { needSerp?: boolean } = {}): void {
  getBrightDataToken();
  getZone("unlocker");
  if (opts.needSerp ?? true) getZone("serp");
  getTimeouts();
}

function readMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new ConfigError(`${name} must be a whole number of milliseconds, got "${raw}".`);
  }
  return n;
}
