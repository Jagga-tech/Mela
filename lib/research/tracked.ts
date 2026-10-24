import { MAX_ATTEMPTS, type ResearchSource } from "./contract";
import type { Classification } from "./classify";
import type { Timeouts } from "./config";

// The status state machine shared by fetchPage and searchOfficialPages.
//
//   queued → fetching ─┬─────────────→ found | empty | blocked | error
//                      └→ slow ──────→ (same)
//   a retryable failure on attempt 1 → fetching (attempt 2) → ...
//
// It owns the timers (soft "slow" timeout, hard cancel timeout), the single
// bounded retry, and the order of status updates. It doesn't know anything
// about Bright Data: callers pass in one attempt function.

/**
 * Called with a fresh copy of the source every time its status changes.
 * The backend passes a function that upserts the row by `id`; scripts pass console.log.
 * Calls are made one at a time, in order, so a slow database write can't reorder them.
 */
export type OnStatus = (source: ResearchSource) => void | Promise<void>;

export interface AttemptResult<T> {
  classification: Classification;
  /** Payload when classification.status is "found" (markdown, search hits, ...). */
  value?: T;
  latencyMs: number;
}

export type AttemptFn<T> = (signal: AbortSignal) => Promise<AttemptResult<T>>;

export interface TrackOptions extends Timeouts {
  inFlightStatus: "fetching" | "searching";
  /** Capped at MAX_ATTEMPTS (2). */
  maxAttempts?: number;
}

export interface TrackedResult<T> {
  source: ResearchSource;
  value?: T;
}

export async function runTracked<T>(
  source: ResearchSource,
  onStatus: OnStatus,
  attemptFn: AttemptFn<T>,
  opts: TrackOptions,
): Promise<TrackedResult<T>> {
  const emitter = createEmitter(onStatus);
  const maxAttempts = Math.max(1, Math.min(opts.maxAttempts ?? MAX_ATTEMPTS, MAX_ATTEMPTS));
  let current: ResearchSource = { ...source, status: opts.inFlightStatus, attempt: 1, error: undefined };
  emitter.emit(current);

  let result: AttemptResult<T>;
  for (let n = 1; ; n++) {
    result = await runOneAttempt(attemptFn, opts, () => {
      current = { ...current, status: "slow" };
      emitter.emit(current);
    });

    const c = result.classification;
    if (c.status === "found" || !c.retryable || n >= maxAttempts) break;

    // Still in flight, with the reason we're retrying, so the row never goes quiet.
    current = {
      ...current,
      status: opts.inFlightStatus,
      attempt: n + 1,
      latencyMs: result.latencyMs,
      error: `attempt ${n} failed (${c.reason ?? c.status}); retrying`,
    };
    emitter.emit(current);
    if (opts.retryDelayMs > 0) await sleep(opts.retryDelayMs);
  }

  const c = result.classification;
  const gotContent = c.status === "found" || c.status === "empty";
  current = {
    ...current,
    status: c.status,
    latencyMs: result.latencyMs,
    fetchedAt: gotContent ? new Date().toISOString() : undefined,
    error: c.status === "found" ? undefined : c.reason,
  };
  emitter.emit(current);
  await emitter.flush(); // the final status is written before we return

  return { source: current, value: c.status === "found" ? result.value : undefined };
}

async function runOneAttempt<T>(
  attemptFn: AttemptFn<T>,
  opts: TrackOptions,
  onSlow: () => void,
): Promise<AttemptResult<T>> {
  const controller = new AbortController();
  const started = performance.now();
  let settled = false;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;

  const softTimer = setTimeout(() => {
    if (!settled) onSlow();
  }, opts.softTimeoutMs);

  // The hard timeout wins the race even if the attempt ignores the abort signal,
  // so no source can hang forever.
  const timedOut = new Promise<"timeout">((resolve) => {
    hardTimer = setTimeout(() => {
      resolve("timeout");
      controller.abort();
    }, opts.hardTimeoutMs);
  });

  const attempt = Promise.resolve().then(() => attemptFn(controller.signal));
  attempt.catch(() => {}); // a late failure after the timeout must not become an unhandled rejection

  try {
    const winner = await Promise.race([attempt, timedOut]);
    if (winner === "timeout") {
      return {
        classification: {
          status: "error",
          retryable: true,
          reason: `no response within ${(opts.hardTimeoutMs / 1000).toFixed(1)} s`,
        },
        latencyMs: opts.hardTimeoutMs,
      };
    }
    return winner;
  } catch (err) {
    // A bug in the attempt function (e.g. a parser crash). Show it, don't retry it.
    console.error("[research] attempt threw", err);
    return {
      classification: {
        status: "error",
        retryable: false,
        reason: `internal error: ${err instanceof Error ? err.message : String(err)}`,
      },
      latencyMs: Math.round(performance.now() - started),
    };
  } finally {
    settled = true;
    clearTimeout(softTimer);
    clearTimeout(hardTimer);
  }
}

function createEmitter(onStatus: OnStatus) {
  let chain: Promise<void> = Promise.resolve();
  return {
    emit(source: ResearchSource) {
      const snapshot = { ...source };
      chain = chain
        .then(() => onStatus(snapshot))
        .catch((err) => {
          // A failed status write shouldn't kill the research itself.
          console.warn(`[research] onStatus failed for ${snapshot.id} (${snapshot.status})`, err);
        });
    },
    flush: () => chain,
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
