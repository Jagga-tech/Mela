import "server-only";
import { getBrightDataToken } from "./config";

// Layer 1: the only code that talks to Bright Data.
//
// It sends one POST and reports what came back. It never throws for HTTP
// errors, timeouts or network failures: in this product a failed fetch is data
// the dashboard shows, so it comes back as a value. Deciding what a response
// *means* (found / blocked / error, retry or not) is classify.ts's job.

export const BRIGHTDATA_ENDPOINT = "https://api.brightdata.com/request";

export interface BrightDataRequest {
  zone: string;
  url: string;
  /** "markdown" asks Web Unlocker to convert the page. Omit for SERP JSON (brd_json=1 in the URL). */
  dataFormat?: "markdown";
  signal?: AbortSignal;
  /** Override the env token. Only for break-things testing (e.g. a deliberately bad key). */
  apiToken?: string;
}

export interface BrightDataResponse {
  /** True only when Bright Data reached the target and the target answered 2xx. */
  ok: boolean;
  /** Status of Bright Data's own response. 400 = unknown zone / bad request, 401 = bad API key. */
  httpStatus?: number;
  /** x-brd-status-code: the result status. The Direct API answers 200 once a request reaches the unlocker. */
  targetStatus?: number;
  /** x-brd-error-code (unlocker level) or x-brd-err-code (proxy level). Branch on this, not on the message. */
  errorCode?: string;
  /** x-brd-error / x-brd-err-msg, or the plain-text body of a 400/401. */
  errorMessage?: string;
  /** Every x-brd-* header, kept for the break-things log and the data-health view. */
  brdHeaders: Record<string, string>;
  body?: string;
  latencyMs: number;
  /** Our own AbortSignal fired (the hard timeout cancelled the request). */
  aborted?: boolean;
  /** fetch() failed before any response arrived (DNS, connection reset, ...). */
  networkError?: string;
}

export type BrightDataRequestFn = (req: BrightDataRequest) => Promise<BrightDataResponse>;

export const brightDataRequest: BrightDataRequestFn = async (req) => {
  // A missing token is a setup bug, so this is the one thing allowed to throw.
  const token = req.apiToken ?? getBrightDataToken();
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  let res: Response;
  try {
    res = await fetch(BRIGHTDATA_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        zone: req.zone,
        url: req.url,
        format: "raw",
        ...(req.dataFormat ? { data_format: req.dataFormat } : {}),
      }),
      signal: req.signal,
      cache: "no-store", // never serve a cached page in the demo path
    });
  } catch (err) {
    return failure(req, err, elapsed());
  }

  let body: string;
  try {
    body = await res.text();
  } catch (err) {
    // The abort signal also cancels reading the body.
    return failure(req, err, elapsed(), res.status);
  }

  const brdHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith("x-brd-")) brdHeaders[key.toLowerCase()] = value;
  });

  const targetStatus = parseStatus(brdHeaders["x-brd-status-code"]);
  const errorCode = brdHeaders["x-brd-error-code"] ?? brdHeaders["x-brd-err-code"];
  const headerMessage = brdHeaders["x-brd-error"] ?? brdHeaders["x-brd-err-msg"];
  // 400/401 rejections carry no x-brd-* headers; the reason is the body text.
  const errorMessage = headerMessage ?? (res.ok ? undefined : snippet(body));

  const effective = targetStatus ?? res.status;
  return {
    ok: res.ok && !headerMessage && !errorCode && effective >= 200 && effective < 300,
    httpStatus: res.status,
    targetStatus,
    errorCode,
    errorMessage,
    brdHeaders,
    body,
    latencyMs: elapsed(),
  };
};

function failure(req: BrightDataRequest, err: unknown, latencyMs: number, httpStatus?: number): BrightDataResponse {
  if (req.signal?.aborted) {
    return { ok: false, aborted: true, httpStatus, brdHeaders: {}, latencyMs, errorMessage: "cancelled by client timeout" };
  }
  return { ok: false, httpStatus, brdHeaders: {}, latencyMs, networkError: describe(err) };
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    const causeMsg = cause instanceof Error ? cause.message : undefined;
    return causeMsg ? `${err.message}: ${causeMsg}` : err.message;
  }
  return String(err);
}

function parseStatus(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function snippet(text: string, max = 300): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
