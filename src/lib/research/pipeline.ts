import "server-only";
import { discoverVendors, type DiscoverVendorsOptions } from "./apify";
import {
  newSource,
  type ExtractedFact,
  type FactField,
  type ResearchEntity,
  type ResearchResult,
  type ResearchSource,
  type SourceType,
  type Vendor,
} from "./contract";
import { extractFacts, type ExtractOptions } from "./extract";
import { fetchPage, type FetchPageOptions } from "./fetchPage";
import type { OnStatus } from "./tracked";
import { failedSourceFacts, fillMissingFields, verifyFact } from "./verify";

// The research job for one event: fetch → extract → verify → store.
//
// Every source row is saved as "queued" before any work starts, and every
// status change after that goes through onSource right away, so the
// dashboard's poll sees in-flight states. Facts for a source are saved as soon
// as that source finishes. Apify runs alongside and never holds up venues.

/** Demo scope: at most 10 sources per event. */
export const MAX_SOURCES = 10;

/** Every fact field, for targets that want all of them. */
export const ALL_FIELDS: readonly FactField[] = [
  "capacity",
  "rental_fee",
  "application_lead_days",
  "application_fee",
  "step_free_access",
  "amplified_sound",
  "alcohol",
  "insurance_required",
  "outside_catering",
];

/** One page to research: a venue's own page, or an authority's rules page. */
export interface ResearchTarget {
  entity: ResearchEntity;
  url: string;
  sourceType: SourceType;
  fields: readonly FactField[];
  /** Venue ids these facts cover. A venue's own page covers itself; a city rule lists the venues it governs. */
  appliesTo: string[];
}

export interface RunResearchInput {
  eventId: string;
  targets: ResearchTarget[];
  /** e.g. ["quinceañera caterer", "florist"]. Each is one Apify source. */
  vendorQueries?: string[];
}

export interface RunResearchDeps {
  /** Upsert the source row by id. Called in order for each source. */
  onSource: OnStatus;
  /** Save a finished source's facts. */
  onFacts?: (facts: ExtractedFact[]) => void | Promise<void>;
  /** Save vendors as each Apify search finishes. */
  onVendors?: (vendors: Vendor[]) => void | Promise<void>;
  fetch?: FetchPageOptions;
  extract?: ExtractOptions;
  vendors?: DiscoverVendorsOptions;
  /** Pages fetched at once. Default 4. */
  concurrency?: number;
}

export class TooManySourcesError extends Error {
  override name = "TooManySourcesError";
}

export async function runResearch(input: RunResearchInput, deps: RunResearchDeps): Promise<ResearchResult> {
  const vendorQueries = input.vendorQueries ?? [];
  const total = input.targets.length + vendorQueries.length;
  if (total > MAX_SOURCES) {
    throw new TooManySourcesError(`${total} sources requested; the limit is ${MAX_SOURCES}.`);
  }

  const sources = new Map<string, ResearchSource>();
  const track: OnStatus = async (s) => {
    sources.set(s.id, s);
    await deps.onSource(s);
  };

  // Queue every page first, so the dashboard shows the whole plan immediately.
  const queued = input.targets.map((target) => ({
    target,
    source: newSource({ url: target.url, provider: "bd_unlocker", sourceType: target.sourceType }),
  }));
  for (const { source } of queued) await safe(track, source);

  const vendorsJob = Promise.all(
    vendorQueries.map(async (query) => {
      const { vendors } = await discoverVendors(query, (s) => safe(track, s), deps.vendors);
      if (vendors.length && deps.onVendors) await safeCall(() => deps.onVendors!(vendors));
      return vendors;
    }),
  );

  const facts: ExtractedFact[] = [];
  await pool(queued, deps.concurrency ?? 4, async ({ target, source }) => {
    const found = await researchTarget(target, source, (s) => safe(track, s), deps);
    facts.push(...found);
    if (deps.onFacts) await safeCall(() => deps.onFacts!(found));
  });

  const vendorLists = await vendorsJob;

  return {
    eventId: input.eventId,
    sources: [...sources.values()],
    facts,
    entities: dedupeEntities(input.targets.map((t) => t.entity)),
    vendors: vendorLists.flat(),
  };
}

/** One target, start to finish. Always returns a fact for every requested field. */
export async function researchTarget(
  target: ResearchTarget,
  source: ResearchSource,
  onStatus: OnStatus,
  deps: Pick<RunResearchDeps, "fetch" | "extract"> = {},
): Promise<ExtractedFact[]> {
  const { entity, fields, appliesTo } = target;

  // A fetched page isn't done yet: hold back fetchPage's "found" so the row goes
  // fetching → extracting → found/partial without flashing "found" in between.
  const fetchStatus: OnStatus = (s) => (s.status === "found" ? undefined : onStatus(s));
  const fetched = await fetchPage(source, fetchStatus, deps.fetch);
  if (fetched.source.status !== "found" || fetched.markdown === undefined) {
    return failedSourceFacts(entity.id, fields, source.id, appliesTo);
  }
  const markdown = fetched.markdown;

  const extracting: ResearchSource = { ...fetched.source, status: "extracting" };
  await onStatus(extracting);

  const extracted = await extractFacts({ markdown, entityName: entity.name, fields }, deps.extract);
  if (!extracted.ok) {
    await onStatus({ ...extracting, status: "error", error: extracted.reason });
    return failedSourceFacts(entity.id, fields, source.id, appliesTo);
  }

  const verified = extracted.candidates.map((c) => verifyFact(markdown, { ...c, entityId: entity.id, appliesTo }, source.id));
  const all = fillMissingFields(verified, entity.id, fields, source.id, appliesTo);

  const unknown = all.filter((f) => f.state === "unknown").length;
  await onStatus({
    ...extracting,
    status: unknown === 0 ? "found" : "partial",
    error: unknown === 0 ? undefined : `${unknown} of ${all.length} fields unknown`,
  });
  return all;
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, size), items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await work(item);
    }
  });
  await Promise.all(workers);
}

/** A failed status write is logged, not fatal: the research itself keeps going. */
async function safe(onStatus: OnStatus, source: ResearchSource): Promise<void> {
  await safeCall(() => onStatus({ ...source }));
}

async function safeCall(fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.warn("[research] save failed", err);
  }
}

function dedupeEntities(entities: ResearchEntity[]): ResearchEntity[] {
  const byId = new Map<string, ResearchEntity>();
  for (const e of entities) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()];
}
