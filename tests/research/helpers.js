// Fakes for testing the research module without calling Bright Data.
export const LONG_PAGE = `# Special Event Application\n\n${"Applications must be submitted at least 60 days in advance. ".repeat(10)}`;
export function pageResponse(body = LONG_PAGE) {
    return { ok: true, httpStatus: 200, targetStatus: 200, brdHeaders: { "x-brd-status-code": "200" }, body, latencyMs: 5 };
}
export function captchaResponse() {
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
export function badKeyResponse() {
    return { ok: false, httpStatus: 401, errorMessage: "Invalid token", brdHeaders: {}, body: "Invalid token", latencyMs: 5 };
}
/** Responds after `ms`, or immediately with an aborted response if the signal fires first. */
export function after(ms, res) {
    return (req) => new Promise((resolve) => {
        const timer = setTimeout(() => resolve(res), ms);
        req.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve({ ok: false, aborted: true, brdHeaders: {}, latencyMs: ms });
        }, { once: true });
    });
}
/** Plays one handler per call, in order, and records every request it received. */
export function sequence(...handlers) {
    const calls = [];
    const request = (req) => {
        calls.push(req);
        const handler = handlers[Math.min(calls.length, handlers.length) - 1];
        if (!handler)
            throw new Error("sequence() needs at least one handler");
        return handler(req);
    };
    return { request, calls };
}
export function recorder() {
    const seen = [];
    return {
        seen,
        onStatus: (s) => {
            seen.push(s);
        },
        statuses: () => seen.map((s) => s.status),
    };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
