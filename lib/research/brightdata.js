import "server-only";
import { getBrightDataToken } from "./config";
// Layer 1: the only code that talks to Bright Data.
//
// It sends one POST and reports what came back. It never throws for HTTP
// errors, timeouts or network failures: in this product a failed fetch is data
// the dashboard shows, so it comes back as a value. Deciding what a response
// *means* (found / blocked / error, retry or not) is classify.ts's job.
export const BRIGHTDATA_ENDPOINT = "https://api.brightdata.com/request";
export const brightDataRequest = async (req) => {
    // A missing token is a setup bug, so this is the one thing allowed to throw.
    const token = req.apiToken ?? getBrightDataToken();
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    let res;
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
    }
    catch (err) {
        return failure(req, err, elapsed());
    }
    let body;
    try {
        body = await res.text();
    }
    catch (err) {
        // The abort signal also cancels reading the body.
        return failure(req, err, elapsed(), res.status);
    }
    const brdHeaders = {};
    res.headers.forEach((value, key) => {
        if (key.toLowerCase().startsWith("x-brd-"))
            brdHeaders[key.toLowerCase()] = value;
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
function failure(req, err, latencyMs, httpStatus) {
    if (req.signal?.aborted) {
        return { ok: false, aborted: true, httpStatus, brdHeaders: {}, latencyMs, errorMessage: "cancelled by client timeout" };
    }
    return { ok: false, httpStatus, brdHeaders: {}, latencyMs, networkError: describe(err) };
}
function describe(err) {
    if (err instanceof Error) {
        const cause = err.cause;
        const causeMsg = cause instanceof Error ? cause.message : undefined;
        return causeMsg ? `${err.message}: ${causeMsg}` : err.message;
    }
    return String(err);
}
function parseStatus(raw) {
    if (!raw)
        return undefined;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : undefined;
}
function snippet(text, max = 300) {
    const t = text.trim();
    if (!t)
        return undefined;
    return t.length > max ? `${t.slice(0, max)}…` : t;
}
