import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { checkResearchConfig, ConfigError, getBrightDataToken, getTimeouts } from "../../lib/research/config";
const KEYS = [
    "BRIGHTDATA_API_TOKEN",
    "BRIGHTDATA_API_KEY",
    "BRIGHTDATA_UNLOCKER_ZONE",
    "BRIGHTDATA_SERP_ZONE",
    "RESEARCH_SOFT_TIMEOUT_MS",
    "RESEARCH_HARD_TIMEOUT_MS",
];
let saved = {};
beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS)
        delete process.env[k];
});
afterEach(() => {
    for (const k of KEYS) {
        if (saved[k] === undefined)
            delete process.env[k];
        else
            process.env[k] = saved[k];
    }
});
describe("config", () => {
    it("throws a ConfigError naming the missing token", () => {
        assert.throws(() => getBrightDataToken(), (e) => e instanceof ConfigError && /BRIGHTDATA_API_TOKEN/.test(e.message));
    });
    it("accepts either token name", () => {
        process.env.BRIGHTDATA_API_KEY = "from-kit";
        assert.equal(getBrightDataToken(), "from-kit");
        process.env.BRIGHTDATA_API_TOKEN = "from-plan";
        assert.equal(getBrightDataToken(), "from-plan");
    });
    it("checkResearchConfig fails fast on a missing zone", () => {
        process.env.BRIGHTDATA_API_TOKEN = "t";
        process.env.BRIGHTDATA_UNLOCKER_ZONE = "web_unlocker1";
        assert.throws(() => checkResearchConfig(), /BRIGHTDATA_SERP_ZONE/);
        assert.doesNotThrow(() => checkResearchConfig({ needSerp: false }));
    });
    it("uses 8 s / 25 s by default and reads overrides from the environment", () => {
        assert.deepEqual(getTimeouts(), { softTimeoutMs: 8000, hardTimeoutMs: 25000, retryDelayMs: 1000 });
        process.env.RESEARCH_SOFT_TIMEOUT_MS = "1000";
        assert.equal(getTimeouts().softTimeoutMs, 1000);
    });
    it("rejects a soft timeout that isn't shorter than the hard one", () => {
        assert.throws(() => getTimeouts({ softTimeoutMs: 30000 }), ConfigError);
        process.env.RESEARCH_HARD_TIMEOUT_MS = "abc";
        assert.throws(() => getTimeouts(), /whole number/);
    });
});
