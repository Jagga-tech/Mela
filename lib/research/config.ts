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
