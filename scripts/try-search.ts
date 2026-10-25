// Run one SERP search and see which results land on allowed (official) domains.
//
//   npm run research:search                                    (default SF permit query)
//   npm run research:search -- "San Francisco park picnic area reservation"
//   npm run research:search -- "zxqv nonsense query qqq"       (should end "empty")
//   npm run research:search -- "<query>" --domains sfrecpark.org,sf.gov
//   npm run research:search -- "<query>" --fresh               (skip the cache)

import { parseArgs } from "node:util";
import { searchOfficialPages, SF_OFFICIAL_DOMAINS } from "../src/lib/research/search";

const DEFAULT_QUERY = "San Francisco park special event permit application";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    fresh: { type: "boolean" }, // skip the cache and fetch live
    domains: { type: "string" },
    zone: { type: "string" },
    max: { type: "string" },
  },
});

const query = positionals[0] ?? DEFAULT_QUERY;
const allowedDomains = values.domains ? values.domains.split(",").map((d) => d.trim()) : SF_OFFICIAL_DOMAINS;
const started = performance.now();
const stamp = () => `+${((performance.now() - started) / 1000).toFixed(1)}s`.padStart(7);

console.log(`Searching: ${query}`);
console.log(`Allowed:   ${allowedDomains.join(", ")}\n`);

const { source, hits } = await searchOfficialPages(
  query,
  (s) => {
    console.log(`${stamp()}  ${s.status.padEnd(9)} attempt ${s.attempt}${s.fromCache ? "  (cached)" : ""}${s.error ? `  ${s.error}` : ""}`);
  },
  {
    allowedDomains,
    zone: values.zone,
    maxResults: values.max ? Number(values.max) : undefined,
    cache: values.fresh ? false : undefined,
  },
);

console.log(`\nFinal:   ${source.status}${source.error ? `  (${source.error})` : ""}`);
console.log(`Latency: ${source.latencyMs ?? "-"} ms, attempts: ${source.attempt}${source.fromCache ? `, cached from ${source.fetchedAt}` : ""}\n`);
for (const hit of hits) {
  console.log(`#${hit.rank}  ${hit.title}\n     ${hit.url}`);
}

process.exitCode = source.status === "found" ? 0 : 1;
