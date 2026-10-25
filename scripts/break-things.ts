// Break things on purpose and log exactly what Bright Data sends back.
//
//   npm run research:break
//   npm run research:break -- <control-url>
//
// Each case calls layer 1 (brightDataRequest) directly, so you see the raw
// response next to how classify.ts reads it. If a row's classification looks
// wrong, fix the tables in lib/research/classify.ts and add a test.
// Full log: .research-out/break-things-<timestamp>.json
//
// Cost: Bright Data bills successful requests only, so this costs a few requests at most.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { brightDataRequest, type BrightDataRequest } from "../src/lib/research/brightdata";
import { classifyResponse } from "../src/lib/research/classify";
import { getZone } from "../src/lib/research/config";

const controlUrl = process.argv[2] ?? "https://sfrecpark.org/541/Special-Event-Application-Information";
const zone = getZone("unlocker");
const notFoundUrl = new URL("/this-page-does-not-exist-calhacks-13", controlUrl).toString();

const cases: Array<{ name: string; expect: string; req: () => BrightDataRequest }> = [
  { name: "control (real page)", expect: "found", req: () => ({ zone, url: controlUrl, dataFormat: "markdown" }) },
  { name: "bad API key", expect: "error, no retry", req: () => ({ zone, url: controlUrl, apiToken: "not-a-real-key" }) },
  { name: "bad zone name", expect: "error, no retry", req: () => ({ zone: "zone_that_does_not_exist", url: controlUrl }) },
  { name: "page that 404s", expect: "error, no retry", req: () => ({ zone, url: notFoundUrl, dataFormat: "markdown" }) },
  { name: "host that doesn't resolve", expect: "error, no retry", req: () => ({ zone, url: "https://no-such-host.invalid/" }) },
  {
    name: "client timeout (0.5 s)",
    expect: "error, retry",
    req: () => ({ zone, url: controlUrl, dataFormat: "markdown", signal: AbortSignal.timeout(500) }),
  },
];

const log: unknown[] = [];
for (const c of cases) {
  const req = c.req();
  const res = await brightDataRequest(req);
  const cls = classifyResponse(res);

  console.log(`\n=== ${c.name}  (expected: ${c.expect})`);
  console.log(`  outer HTTP:    ${res.httpStatus ?? "-"}`);
  console.log(`  target status: ${res.targetStatus ?? "-"}`);
  console.log(`  error code:    ${res.errorCode ?? "-"}`);
  console.log(`  message:       ${res.errorMessage ?? res.networkError ?? "-"}`);
  console.log(`  x-brd headers: ${Object.keys(res.brdHeaders).join(", ") || "-"}`);
  console.log(`  latency:       ${res.latencyMs} ms, body ${res.body?.length ?? 0} chars`);
  console.log(`  → classified:  ${cls.status}${cls.retryable ? " (retryable)" : ""}${cls.reason ? `  ${cls.reason}` : ""}`);

  log.push({
    case: c.name,
    expected: c.expect,
    request: { zone: req.zone, url: req.url, dataFormat: req.dataFormat, badKey: Boolean(req.apiToken) },
    response: { ...res, body: res.body?.slice(0, 2000) },
    classification: cls,
  });
}

const outDir = ".research-out";
await mkdir(outDir, { recursive: true });
const file = path.join(outDir, `break-things-${Date.now()}.json`);
await writeFile(file, JSON.stringify(log, null, 2));
console.log(`\nSaved ${file}`);
