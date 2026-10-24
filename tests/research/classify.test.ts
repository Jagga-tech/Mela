import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BrightDataResponse } from "../../lib/research/brightdata";
import { classifyResponse } from "../../lib/research/classify";
import { LONG_PAGE } from "./helpers";

function res(partial: Partial<BrightDataResponse>): BrightDataResponse {
  return { ok: false, brdHeaders: {}, latencyMs: 100, ...partial };
}

function withCode(code: string, targetStatus = 502): BrightDataResponse {
  return res({
    httpStatus: 200,
    targetStatus,
    errorCode: code,
    errorMessage: "msg",
    brdHeaders: { "x-brd-error-code": code, "x-brd-error": "msg", "x-brd-status-code": String(targetStatus) },
  });
}

// [case, response, expected status, expected retryable]
const table: Array<[string, BrightDataResponse, string, boolean]> = [
  ["target 200 with content", res({ ok: true, httpStatus: 200, targetStatus: 200, body: LONG_PAGE }), "found", false],
  ["target 200, almost no text", res({ ok: true, httpStatus: 200, targetStatus: 200, body: "  hi  " }), "empty", false],
  ["our hard timeout", res({ aborted: true, latencyMs: 25_000 }), "error", true],
  ["network failure", res({ networkError: "getaddrinfo ENOTFOUND" }), "error", true],
  ["bad API key (outer 401)", res({ httpStatus: 401, errorMessage: "Invalid token", body: "Invalid token" }), "error", false],
  ["unknown zone (outer 400)", res({ httpStatus: 400, errorMessage: 'zone "x" not found' }), "error", false],
  ["CAPTCHA page", withCode("reject_block"), "blocked", true],
  ["CAPTCHA solve failed", withCode("resolve_failed_akamai_interstitial"), "blocked", true],
  ["site sent a blocking status", withCode("http_status"), "blocked", true],
  ["expired certificate", withCode("net_err_cert_date_invalid"), "error", false],
  ["premium domain", withCode("premium", 400), "blocked", false],
  ["robots.txt in immediate-access mode", withCode("ub_bad_endpoint_robots", 400), "blocked", false],
  ["zone auth via proxy code", withCode("client_10002", 407), "error", false],
  ["host doesn't resolve", withCode("proxy_error"), "error", false],
  ["navigation timeout", withCode("navigation_timeout"), "error", true],
  ["a code we haven't mapped", withCode("brand_new_code"), "error", true],
  ["target 404", res({ httpStatus: 200, targetStatus: 404, body: "Not found" }), "error", false],
  ["target 403 (login wall)", res({ httpStatus: 200, targetStatus: 403, body: "Forbidden" }), "blocked", false],
  ["target 429", res({ httpStatus: 200, targetStatus: 429 }), "blocked", true],
  ["target 503", res({ httpStatus: 200, targetStatus: 503 }), "error", true],
  [
    "Bright Data policy block, no code",
    res({ httpStatus: 200, targetStatus: 403, errorMessage: "Forbidden", brdHeaders: { "x-brd-error": "Forbidden" } }),
    "blocked",
    false,
  ],
  [
    "browser check failed, no code",
    res({ httpStatus: 200, targetStatus: 503, errorMessage: "check", brdHeaders: { "x-brd-error": "check" } }),
    "blocked",
    true,
  ],
];

describe("classifyResponse", () => {
  for (const [name, response, status, retryable] of table) {
    it(`${name} → ${status}${retryable ? " (retry)" : ""}`, () => {
      const c = classifyResponse(response);
      assert.equal(c.status, status);
      assert.equal(c.retryable, retryable);
      if (status === "found") assert.equal(c.reason, undefined);
      else assert.ok(c.reason, "every non-found result needs a reason for the dashboard");
    });
  }

  it("says which key problem it was", () => {
    const c = classifyResponse(res({ httpStatus: 401, errorMessage: "Invalid token" }));
    assert.match(c.reason!, /API key/);
    assert.match(c.reason!, /Invalid token/);
  });

  it("respects a custom minimum content length", () => {
    const c = classifyResponse(res({ ok: true, httpStatus: 200, targetStatus: 200, body: "{}" }), { minContentChars: 1 });
    assert.equal(c.status, "found");
  });
});
