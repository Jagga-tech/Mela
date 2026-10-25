import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResearchSource } from "./contract";
import { getCacheSettings } from "./config";
import type { OnStatus } from "./tracked";

// A cache of real, successful fetches, so a rehearsed demo query answers fast
// and a judge's new query still goes live.
//
// Rules that keep it honest:
//   - Only "found" results are stored. Failures always run live again.
//   - An entry keeps the fetchedAt of the original live fetch.
//   - A hit is marked fromCache on the source row, so the dashboard can say so.
//   - RESEARCH_CACHE=off turns it off. The ablation test must run that way.

export interface CacheEntry<T> {
  /** ISO time of the live fetch that produced this value. */
  fetchedAt: string;
  value: T;
}

export interface ResearchCache {
  get<T>(key: string): Promise<CacheEntry<T> | undefined>;
  set<T>(key: string, entry: CacheEntry<T>): Promise<void>;
}

/** Per-call cache option: a cache, false for none, or undefined for the default. */
export type CacheOption = ResearchCache | false | undefined;

export function cacheKey(...parts: string[]): string {
  return parts.join("\n");
}

/** In-process cache, for tests and short-lived scripts. */
export function memoryCache(ttlMs = Infinity, now: () => number = Date.now): ResearchCache {
  const entries = new Map<string, CacheEntry<unknown>>();
  return {
    async get<T>(key: string) {
      const entry = entries.get(key) as CacheEntry<T> | undefined;
      return entry && fresh(entry, ttlMs, now()) ? entry : undefined;
    },
    async set<T>(key: string, entry: CacheEntry<T>) {
      entries.set(key, entry);
    },
  };
}

/**
 * One JSON file per key under `dir`. Survives restarts, so a cache warmed during
 * rehearsal is still there for the recording. A broken or unreadable file is a miss.
 */
export function fileCache(dir: string, ttlMs: number, now: () => number = Date.now): ResearchCache {
  const fileFor = (key: string) => path.join(dir, `${createHash("sha256").update(key).digest("hex")}.json`);
  return {
    async get<T>(key: string) {
      let stored: { key?: string } & Partial<CacheEntry<T>>;
      try {
        stored = JSON.parse(await readFile(fileFor(key), "utf8"));
      } catch {
        return undefined;
      }
      if (stored.key !== key || typeof stored.fetchedAt !== "string" || stored.value === undefined) return undefined;
      const entry: CacheEntry<T> = { fetchedAt: stored.fetchedAt, value: stored.value };
      return fresh(entry, ttlMs, now()) ? entry : undefined;
    },
    async set<T>(key: string, entry: CacheEntry<T>) {
      await mkdir(dir, { recursive: true });
      const file = fileFor(key);
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, JSON.stringify({ key, ...entry }));
      await rename(tmp, file); // readers never see a half-written file
    },
  };
}

/** The cache real calls use when the caller doesn't pass one. Undefined when RESEARCH_CACHE=off. */
export function getDefaultCache(): ResearchCache | undefined {
  const settings = getCacheSettings();
  return settings.enabled ? fileCache(settings.dir, settings.ttlMs) : undefined;
}

/**
 * Picks the cache for one call. Tests that inject a fake request get no cache
 * unless they pass one, so they never touch the disk.
 */
export function resolveCache(option: CacheOption, usingFakeRequest: boolean): ResearchCache | undefined {
  if (option === false) return undefined;
  if (option) return option;
  return usingFakeRequest ? undefined : getDefaultCache();
}

/** A cache problem must never fail the research, so errors count as a miss. */
export async function readCache<T>(cache: ResearchCache | undefined, key: string): Promise<CacheEntry<T> | undefined> {
  if (!cache) return undefined;
  try {
    return await cache.get<T>(key);
  } catch (err) {
    console.warn("[research] cache read failed; fetching live", err);
    return undefined;
  }
}

export async function writeCache<T>(cache: ResearchCache | undefined, key: string, entry: CacheEntry<T>): Promise<void> {
  if (!cache) return;
  try {
    await cache.set(key, entry);
  } catch (err) {
    console.warn("[research] cache write failed", err);
  }
}

/**
 * Emits the single status update for a cache hit: found, fromCache, the
 * original fetchedAt, and attempt 0 because no live attempt was made.
 */
export async function emitCacheHit(
  source: ResearchSource,
  onStatus: OnStatus,
  entry: CacheEntry<unknown>,
  latencyMs: number,
): Promise<ResearchSource> {
  const final: ResearchSource = {
    ...source,
    status: "found",
    attempt: 0,
    fetchedAt: entry.fetchedAt,
    latencyMs,
    fromCache: true,
    error: undefined,
  };
  try {
    await onStatus({ ...final });
  } catch (err) {
    console.warn(`[research] onStatus failed for ${final.id} (found, cached)`, err);
  }
  return final;
}

function fresh(entry: CacheEntry<unknown>, ttlMs: number, nowMs: number): boolean {
  const at = Date.parse(entry.fetchedAt);
  return Number.isFinite(at) && nowMs - at <= ttlMs;
}
