// List SF Rec & Park properties from DataSF's public API (no Bright Data, no keys).
//
//   npm run research:parks
//   npm run research:parks -- --find dolores        (filter names)
//   npm run research:parks -- --fresh               (skip the cache)

import { parseArgs } from "node:util";
import { discoverParks } from "../src/lib/research/opendata";

const { values } = parseArgs({
  options: {
    find: { type: "string" },
    fresh: { type: "boolean" },
  },
});

const started = performance.now();
const stamp = () => `+${((performance.now() - started) / 1000).toFixed(1)}s`.padStart(7);

const { source, parks } = await discoverParks(
  (s) => {
    console.log(`${stamp()}  ${s.status.padEnd(9)} attempt ${s.attempt}${s.fromCache ? "  (cached)" : ""}${s.error ? `  ${s.error}` : ""}`);
  },
  { cache: values.fresh ? false : undefined },
);

console.log(`\nFinal:     ${source.status}${source.error ? `  (${source.error})` : ""}`);
console.log(`Latency:   ${source.latencyMs ?? "-"} ms, attempts: ${source.attempt}`);
console.log(`FetchedAt: ${source.fetchedAt ?? "-"}${source.fromCache ? " (served from cache)" : ""}`);
console.log(`Parks:     ${parks.length}\n`);

const needle = values.find?.toLowerCase();
const shown = needle ? parks.filter((p) => p.name.toLowerCase().includes(needle)) : parks.slice(0, 10);
for (const p of shown) {
  console.log(`${p.id.padEnd(12)} ${p.name}${p.acres ? `  (${p.acres.toFixed(1)} acres)` : ""}`);
}
if (!needle && parks.length > shown.length) console.log(`... and ${parks.length - shown.length} more (--find <name> to filter)`);

process.exitCode = source.status === "found" ? 0 : 1;
