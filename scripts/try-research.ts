// Full pipeline on real pages: fetch → extract → verify, plus optional Apify vendors.
//
//   npm run research:run -- --url https://palaceoffinearts.com/ --name "Palace of Fine Arts"
//   npm run research:run -- --url <venue> --name <name> --url <venue2> --name <name2>
//   npm run research:run -- --url <venue> --name <name> --vendor "quinceañera caterer"
//   npm run research:run -- ... --fresh            (skip every cache: required for the ablation run)
//
// Needs BRIGHTDATA_* and ANTHROPIC_API_KEY in .env.local, plus APIFY_TOKEN for --vendor.
// The full ResearchResult is saved to .research-out/.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { ALL_FIELDS, runResearch, type ResearchTarget } from "../src/lib/research/pipeline";

const { values } = parseArgs({
  options: {
    url: { type: "string", multiple: true },
    name: { type: "string", multiple: true },
    vendor: { type: "string", multiple: true },
    fresh: { type: "boolean" },
  },
});

const urls = values.url ?? [];
const names = values.name ?? [];
if (urls.length === 0 || urls.length !== names.length) {
  console.error('Pass one --name per --url, e.g. --url https://example.com --name "Example Venue"');
  process.exit(2);
}

const targets: ResearchTarget[] = urls.map((url, i) => {
  const id = names[i]!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    entity: { id, name: names[i]!, kind: "venue", url },
    url,
    sourceType: "venue_site",
    fields: ALL_FIELDS,
    appliesTo: [id],
  };
});

const started = performance.now();
const stamp = () => `+${((performance.now() - started) / 1000).toFixed(1)}s`.padStart(7);
const short = (u: string) => (u.length > 60 ? `${u.slice(0, 57)}...` : u);
const noCache = values.fresh ? { cache: false as const } : {};

const result = await runResearch(
  { eventId: `cli-${Date.now()}`, targets, vendorQueries: values.vendor },
  {
    onSource: (s) => {
      const tags = [s.provider, s.fromCache ? "cached" : "", s.attempt ? `attempt ${s.attempt}` : ""].filter(Boolean).join(", ");
      console.log(`${stamp()}  ${s.status.padEnd(10)} ${short(s.url)}  (${tags})${s.error ? `  ${s.error}` : ""}`);
    },
    fetch: noCache,
    extract: noCache,
    vendors: noCache,
  },
);

console.log("\n--- facts ---");
for (const f of result.facts) {
  const shown =
    f.state === "verified" ? `${String(f.value).padEnd(20)} ${f.confidence?.padEnd(8)} "${f.quote}"` : `unknown (${f.unknownReason})`;
  console.log(`${f.entityId.padEnd(24)} ${f.field.padEnd(22)} ${shown}`);
}

if (result.vendors?.length) {
  console.log("\n--- vendors ---");
  for (const v of result.vendors) {
    console.log(`${v.name}${v.rating ? `  ★${v.rating}` : ""}${v.website ? `  ${v.website}` : ""}`);
  }
}

const verified = result.facts.filter((f) => f.state === "verified").length;
console.log(`\n${verified} of ${result.facts.length} facts verified, ${result.sources.length} sources, ${(performance.now() - started) / 1000} s`);

const outDir = ".research-out";
await mkdir(outDir, { recursive: true });
const file = path.join(outDir, `research-${Date.now()}.json`);
await writeFile(file, JSON.stringify(result, null, 2));
console.log(`Saved ${file}`);
