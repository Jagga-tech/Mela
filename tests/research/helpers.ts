// Fakes for testing the research module without calling Bright Data.

import type { BrightDataRequest, BrightDataRequestFn, BrightDataResponse } from "../../src/lib/research/brightdata";
import type { ResearchSource } from "../../src/lib/research/contract";

export const LONG_PAGE = `# Special Event Application\n\n${"Applications must be submitted at least 60 days in advance. ".repeat(10)}`;

export function pageResponse(body = LONG_PAGE): BrightDataResponse {
  return { ok: true, httpStatus: 200, targetStatus: 200, brdHeaders: { "x-brd-status-code": "200" }, body, latencyMs: 5 };
}

export function captchaResponse(): BrightDataResponse {
  return {
    ok: false,
    httpStatus: 200,
    targetStatus: 502,
    errorCode: "reject_block",
    errorMessage: "captcha or protection page found",
    brdHeaders: {
      "x-brd-status-code": "502",
      "x-brd-error-code": "reject_block",
      "x-brd-error": "captcha or protection page found",
    },
    body: "",
    latencyMs: 5,
  };
}

export function badKeyResponse(): BrightDataResponse {
  return { ok: false, httpStatus: 401, errorMessage: "Invalid token", brdHeaders: {}, body: "Invalid token", latencyMs: 5 };
}

/** Responds after `ms`, or immediately with an aborted response if the signal fires first. */
export function after(ms: number, res: BrightDataResponse): (req: BrightDataRequest) => Promise<BrightDataResponse> {
  return (req) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(res), ms);
      req.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve({ ok: false, aborted: true, brdHeaders: {}, latencyMs: ms });
        },
        { once: true },
      );
    });
}

/** Plays one handler per call, in order, and records every request it received. */
export function sequence(...handlers: Array<(req: BrightDataRequest) => Promise<BrightDataResponse>>) {
  const calls: BrightDataRequest[] = [];
  const request: BrightDataRequestFn = (req) => {
    calls.push(req);
    const handler = handlers[Math.min(calls.length, handlers.length) - 1];
    if (!handler) throw new Error("sequence() needs at least one handler");
    return handler(req);
  };
  return { request, calls };
}

export function recorder() {
  const seen: ResearchSource[] = [];
  return {
    seen,
    onStatus: (s: ResearchSource) => {
      seen.push(s);
    },
    statuses: () => seen.map((s) => s.status),
  };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
