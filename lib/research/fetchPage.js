import "server-only";
import { brightDataRequest } from "./brightdata";
import { classifyResponse } from "./classify";
import { getBrightDataToken, getTimeouts, getZone } from "./config";
import { runTracked } from "./tracked";
export async function fetchPage(source, onStatus, options = {}) {
    // Setup problems throw here, before any status is emitted.
    const request = options.request ?? brightDataRequest;
    if (!options.request)
        getBrightDataToken();
    const zone = options.zone ?? getZone("unlocker");
    const timeouts = getTimeouts(options);
    const urlProblem = checkUrl(source.url);
    if (urlProblem) {
        const failed = { ...source, status: "error", error: urlProblem };
        try {
            await onStatus({ ...failed });
        }
        catch (err) {
            console.warn(`[research] onStatus failed for ${failed.id} (error)`, err);
        }
        return { source: failed };
    }
    const { source: final, value } = await runTracked(source, onStatus, async (signal) => {
        const res = await request({ zone, url: source.url, dataFormat: "markdown", signal });
        return {
            classification: classifyResponse(res, { minContentChars: options.minContentChars }),
            value: res.body,
            latencyMs: res.latencyMs,
        };
    }, { ...timeouts, inFlightStatus: "fetching", maxAttempts: options.maxAttempts });
    return { source: final, markdown: value };
}
function checkUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        return `invalid URL: ${raw}`;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        return `unsupported URL scheme: ${url.protocol}`;
    }
    return undefined;
}
