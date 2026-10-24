import type { BrightDataResponse } from "./brightdata";

// Turns a raw Bright Data response into what the dashboard shows and whether
// one retry is worth it.
//
// The mapping follows Bright Data's Web Unlocker error catalog
// (docs.brightdata.com/products/web-unlocker/error-codes). Confirm it against
// real responses with scripts/break-things.ts and adjust the tables below.
//
//   blocked = the site or a policy refused access (CAPTCHA, login wall, robots.txt)
//   error   = something broke (timeout, bad key, bad zone, 404, bad certificate)
//   empty   = we got a page, but nothing usable on it

export type FetchOutcome = "found" | "empty" | "blocked" | "error";

export interface Classification {
  status: FetchOutcome;
  retryable: boolean;
  /** Plain-language reason for the dashboard and data-health view. Absent when found. */
  reason?: string;
}

/** Pages shorter than this (after trimming) count as "empty". */
export const DEFAULT_MIN_CONTENT_CHARS = 100;

interface CodeRule {
  status: "blocked" | "error";
  retryable: boolean;
  label: string;
}

// Exact x-brd-error-code / x-brd-err-code values.
const CODE_RULES: Record<string, CodeRule> = {
  // Anti-bot: each retry uses a different peer, so one more try can succeed.
  reject_block: { status: "blocked", retryable: true, label: "CAPTCHA or protection page" },
  http_status: { status: "blocked", retryable: true, label: "site answered with a blocking status" },
  sr_rate_limit: { status: "blocked", retryable: true, label: "throttled by Bright Data (low success rate)" },
  rate_limit: { status: "blocked", retryable: true, label: "rate limited" },
  // Refused by configuration or policy: retrying returns the same result.
  premium: { status: "blocked", retryable: false, label: "domain needs Premium domains enabled on the zone" },
  ub_bad_endpoint_robots: { status: "blocked", retryable: false, label: "disallowed by robots.txt (account in immediate-access mode)" },
  // Our request or the target is broken: retrying returns the same result.
  feature_not_active: { status: "error", retryable: false, label: "request used a feature the zone hasn't enabled" },
  expect_element: { status: "error", retryable: false, label: "page loaded but expected content never appeared" },
  document_load_failed: { status: "error", retryable: false, label: "page failed to load" },
  proxy_error: { status: "error", retryable: false, label: "host could not be resolved" },
  no_peers: { status: "error", retryable: false, label: "no peers for the requested country" },
  // Timeouts on Bright Data's side: one retry is reasonable.
  navigation_timeout: { status: "error", retryable: true, label: "page took too long to load" },
  domcontentloaded_event_timeout: { status: "error", retryable: true, label: "page took too long to load" },
  net_err_closed: { status: "error", retryable: true, label: "connection closed by the site" },
};

// Code prefixes, checked after exact matches.
const PREFIX_RULES: Array<[prefix: string, rule: CodeRule]> = [
  ["resolve_failed_", { status: "blocked", retryable: true, label: "CAPTCHA could not be solved" }],
  ["net_err_cert_", { status: "error", retryable: false, label: "site has an invalid TLS certificate" }],
  ["client_", { status: "error", retryable: false, label: "zone or credentials rejected" }],
  ["policy_", { status: "blocked", retryable: false, label: "blocked by Bright Data policy" }],
];

export function classifyResponse(
  res: BrightDataResponse,
  opts: { minContentChars?: number } = {},
): Classification {
  const minChars = opts.minContentChars ?? DEFAULT_MIN_CONTENT_CHARS;

  if (res.aborted) {
    return { status: "error", retryable: true, reason: `no response within ${seconds(res.latencyMs)}` };
  }
  if (res.networkError) {
    return { status: "error", retryable: true, reason: `network error: ${res.networkError}` };
  }

  // Rejected before Bright Data tried to unlock anything.
  if (res.httpStatus === 401) {
    return { status: "error", retryable: false, reason: `Bright Data rejected the API key${detail(res)}` };
  }

  if (res.errorCode) {
    const rule = CODE_RULES[res.errorCode] ?? PREFIX_RULES.find(([p]) => res.errorCode!.startsWith(p))?.[1];
    if (rule) {
      return { status: rule.status, retryable: rule.retryable, reason: `${rule.label} (${res.errorCode})` };
    }
    // A code we haven't mapped yet: show it as-is and allow the one retry.
    return { status: "error", retryable: true, reason: `Bright Data error ${res.errorCode}${detail(res)}` };
  }

  if (res.httpStatus === 400) {
    // Unknown zone name or an invalid request body. Our bug, so no retry.
    return { status: "error", retryable: false, reason: `request rejected by Bright Data${detail(res)}` };
  }

  const status = res.targetStatus ?? res.httpStatus ?? 0;

  // A Bright Data error message without a code (e.g. a 403 policy block or 503 browser check).
  if (res.brdHeaders["x-brd-error"] || res.brdHeaders["x-brd-err-msg"]) {
    if (status === 403) return { status: "blocked", retryable: false, reason: `blocked by Bright Data policy${detail(res)}` };
    if (status === 503) return { status: "blocked", retryable: true, reason: `browser check failed${detail(res)}` };
    return { status: "error", retryable: true, reason: `Bright Data error${detail(res)}` };
  }

  // No Bright Data error, so this is the target site's own answer.
  if (status >= 200 && status < 300) {
    const length = (res.body ?? "").trim().length;
    if (length < minChars) {
      return { status: "empty", retryable: false, reason: `page returned only ${length} characters of content` };
    }
    return { status: "found", retryable: false };
  }
  if (status === 401 || status === 403) {
    return { status: "blocked", retryable: false, reason: `site refused access (HTTP ${status}), possibly a login wall` };
  }
  if (status === 404 || status === 410) {
    return { status: "error", retryable: false, reason: `page not found (HTTP ${status})` };
  }
  if (status === 429) {
    return { status: "blocked", retryable: true, reason: "site rate-limited the request (HTTP 429)" };
  }
  if (status >= 500) {
    return { status: "error", retryable: true, reason: `site error (HTTP ${status})` };
  }
  return { status: "error", retryable: false, reason: `unexpected response (HTTP ${status || "none"})` };
}

function detail(res: BrightDataResponse): string {
  const parts: string[] = [];
  const status = res.targetStatus ?? res.httpStatus;
  if (status) parts.push(String(status));
  if (res.errorMessage) parts.push(res.errorMessage);
  return parts.length ? `: ${parts.join(" ")}` : "";
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
