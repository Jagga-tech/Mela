// Fetch one page through Web Unlocker and watch its status change.
//
//   npm run research:fetch                                   (SF Rec & Park special-event page)
//   npm run research:fetch -- <url>
//   npm run research:fetch -- <url> --find "60 days" --find '$85'
//   npm run research:fetch -- <url> --soft 1000              (watch it go "slow")
//   npm run research:fetch -- <url> --zone not_a_zone        (watch it fail)
//   npm run research:fetch -- <url> --fresh                  (skip the cache)
//
// The full markdown is saved to .research-out/ so you can read what extraction will see.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { newSource } from "../src/lib/research/contract";
import { fetchPage } from "../src/lib/research/fetchPage";

const DEFAULT_URL = "https://sfrecpark.org/541/Special-Event-Application-Information";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    fresh: { type: "boolean" }, // skip the cache and fetch live
    zone: { type: "string" },
    soft: { type: "string" },
    hard: { type: "string" },
    find: { type: "string", multiple: true },
  },
});

const url = positionals[0] ?? DEFAULT_URL;
const started = performance.now();
const stamp = () => `+${((performance.now() - started) / 1000).toFixed(1)}s`.padStart(7);

const source = newSource({ url, provider: "bd_unlocker", sourceType: "official_city" });
console.log(`Fetching ${url}\n`);

const { source: final, markdown } = await fetchPage(
  source,
  (s) => {
    console.log(`${stamp()}  ${s.status.padEnd(9)} attempt ${s.attempt}${s.fromCache ? "  (cached)" : ""}${s.error ? `  ${s.error}` : ""}`);
  },
  {
    zone: values.zone,
    softTimeoutMs: values.soft ? Number(values.soft) : undefined,
    hardTimeoutMs: values.hard ? Number(values.hard) : undefined,
    cache: values.fresh ? false : undefined,
  },
);

console.log(`\nFinal:     ${final.status}`);
console.log(`Latency:   ${final.latencyMs ?? "-"} ms (last attempt), attempts: ${final.attempt}`);
console.log(`FetchedAt: ${final.fetchedAt ?? "-"}${final.fromCache ? " (served from cache; --fresh to refetch)" : ""}`);
if (final.error) console.log(`Reason:    ${final.error}`);

if (markdown) {
  const outDir = ".research-out";
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${slug(url)}-${Date.now()}.md`);
  await writeFile(file, markdown);
  console.log(`Saved:     ${file} (${markdown.length} characters)`);

  for (const needle of values.find ?? []) {
    const hit = normalize(markdown).includes(normalize(needle));
    console.log(`Find:      ${hit ? "yes" : "NO "}  "${needle}"`);
  }

  console.log(`\n--- first 500 characters ---\n${markdown.slice(0, 500)}`);
}

process.exitCode = final.status === "found" ? 0 : 1;

function slug(u: string): string {
  const { hostname, pathname } = new URL(u);
  return `${hostname}${pathname}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80);
}

// Same idea as the verification step: case and whitespace shouldn't decide a match.
function normalize(text: string): string {
  return text.toLowerCase().replace(/[*_#|]/g, "").replace(/\s+/g, " ");
}
