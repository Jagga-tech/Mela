import "server-only";
import type { EventBrief } from "@/mela/contracts";
import { discoverVendors, type DiscoverVendorsOptions } from "./apify";
import { newSource, type ExtractedFact, type FactField, type ResearchSource, type Vendor } from "./contract";
import type { ExtractOptions } from "./extract";
import type { FetchPageOptions } from "./fetchPage";
import { MAX_SOURCES, researchTarget } from "./pipeline";
import { searchOfficialPages, type SearchHit, type SearchOptions } from "./search";
import type { OnStatus } from "./tracked";
import { failedSourceFacts } from "./verify";

// One research job for one confirmed brief:
//
//   SERP search for venue sites ─┬─ fetch → extract → verify, per venue
//   (plus seed URLs)             │
//   Apify search for caterers ───┴─ fetch → extract → verify, per caterer website
//
// Both branches run at once. Every source row is saved the moment it changes,
// so the poll sees in-flight states. Nothing is invented: a venue whose page
// fails keeps every field unknown / source_failed.

export const MAX_VENUES = 4;
export const MAX_CATERERS = 3;

export const VENUE_FIELDS: readonly FactField[] = [
  "capacity",
  "rental_fee",
  "cleaning_fee",
  "bathrooms",
  "climate_control",
  "outside_catering",
  "alcohol",
  "step_free_access",
  "indoor_outdoor",
  "style",
  "contact_phone",
];

export const CATERER_FIELDS: readonly FactField[] = [
  "price_per_guest",
  "cuisine",
  "meat_options",
  "vegetarian_options",
  "service_area",
  "contact_phone",
];

/**
 * Venue search wants a venue's own site, not a list of venues: one page per
 * source, no crawling. Government sites are left out because Bright Data's
 * usage policy refuses them (they come back blocked).
 */
export const DIRECTORY_DOMAINS = [
  "yelp.com", "tripadvisor.com", "peerspace.com", "eventbrite.com", "facebook.com", "instagram.com",
  "weddingwire.com", "theknot.com", "zola.com", "reddit.com", "tiktok.com", "youtube.com", "pinterest.com",
  "x.com", "twitter.com", "linkedin.com", "wikipedia.org", "google.com", "giggster.com", "tagvenue.com",
  "splacer.co", "eventective.com", "partyslate.com", "thumbtack.com", "yellowpages.com", "mapquest.com",
  "cvent.com", "uniquevenues.com", "venuereport.com", "here.com", "sfgate.com", "sfstation.com", "7x7.com",
  "timeout.com", "eater.com", "theinfatuation.com", "opentable.com", "bizbash.com", "gov", "sfrecpark.org",
] as const;

export type VendorCategory = "venue" | "catering";

/** A venue or caterer the job researches. */
export interface JobVendor {
  id: string;
  name: string;
  category: VendorCategory;
  website?: string;
  /** From the Google Maps listing, when Apify found it. */
  phone?: string;
  mapsUrl?: string;
}

export interface JobRecord {
  id: string;
  brief: EventBrief;
  startedAt: string;
  finishedAt?: string;
  cancelled: boolean;
  done: boolean;
  /** Insertion order is display order. */
  sources: Map<string, ResearchSource>;
  /** Which vendor a page source belongs to. */
  sourceVendor: Map<string, string>;
  /** Search label for discovery rows ("venue search", "caterer search"). */
  sourceQuery: Map<string, string>;
  vendors: Map<string, JobVendor>;
  facts: ExtractedFact[];
}

export interface Seed {
  url: string;
  name: string;
}

export interface JobDeps {
  search?: SearchOptions;
  fetch?: FetchPageOptions;
  extract?: ExtractOptions;
  vendors?: DiscoverVendorsOptions;
  /** Seed venue URLs for the brief's city (URLs only, never facts). */
  seeds?: Seed[];
  concurrency?: number;
}

export function createJob(id: string, brief: EventBrief, now = new Date()): JobRecord {
  return {
    id,
    brief,
    startedAt: now.toISOString(),
    cancelled: false,
    done: false,
    sources: new Map(),
    sourceVendor: new Map(),
    sourceQuery: new Map(),
    vendors: new Map(),
    facts: [],
  };
}

/** Marks every unfinished row cancelled. Work already in flight finishes, but its writes are dropped. */
export function cancelJob(job: JobRecord, now = new Date()): void {
  if (job.done || job.cancelled) return;
  job.cancelled = true;
  job.finishedAt = now.toISOString();
  for (const [id, s] of job.sources) {
    if (!["found", "partial", "empty", "blocked", "error"].includes(s.status)) {
      job.sources.set(id, { ...s, status: "error", error: "Cancelled by you" });
    }
  }
}

export async function runJob(job: JobRecord, deps: JobDeps = {}): Promise<void> {
  const record = (vendorId?: string, query?: string): OnStatus => (s) => {
    if (job.cancelled) return;
    job.sources.set(s.id, s);
    if (vendorId) job.sourceVendor.set(s.id, vendorId);
    if (query) job.sourceQuery.set(s.id, query);
  };

  const city = job.brief.city.trim();
  try {
    await Promise.all([venueBranch(job, city, record, deps), catererBranch(job, city, record, deps)]);
  } finally {
    if (!job.cancelled) {
      job.done = true;
      job.finishedAt = new Date().toISOString();
    }
  }
}

type Recorder = (vendorId?: string, query?: string) => OnStatus;

async function venueBranch(job: JobRecord, city: string, record: Recorder, deps: JobDeps): Promise<void> {
  const venues: JobVendor[] = (deps.seeds ?? []).slice(0, MAX_VENUES).map((s) => ({
    id: vendorIdFor("venue", s.url),
    name: s.name,
    category: "venue",
    website: s.url,
  }));

  const occasion = job.brief.occasion.trim() || "party";
  const query = `${occasion} event venue rental ${city}`;
  if (venues.length < MAX_VENUES) {
    const label = `venue search: "${query}"`;
    try {
      const { hits } = await searchOfficialPages(query, record(undefined, label), {
        allowedDomains: "any",
        excludedDomains: DIRECTORY_DOMAINS,
        maxResults: 10,
        sourceType: "venue_site",
        ...deps.search,
      });
      for (const hit of onePerDomain(hits)) {
        if (venues.length >= MAX_VENUES) break;
        const id = vendorIdFor("venue", hit.url);
        if (venues.some((v) => v.id === id)) continue;
        venues.push({ id, name: nameFromTitle(hit), category: "venue", website: hit.url });
      }
    } catch (err) {
      failedRow(job, record(undefined, label), "bd_serp", "venue_site", `https://www.google.com/search?q=${encodeURIComponent(query)}`, err);
    }
  }

  await researchAll(job, venues, VENUE_FIELDS, "venue_site", record, deps);
}

async function catererBranch(job: JobRecord, city: string, record: Recorder, deps: JobDeps): Promise<void> {
  const cuisine = job.brief.requirements.find((r) => r.key === "cuisine" && typeof r.value === "string")?.value as string | undefined;
  const query = `${cuisine ? `${cuisine} ` : ""}caterer`;
  const label = `caterer search: "${query}" near ${city}`;

  let found: Vendor[] = [];
  try {
    ({ vendors: found } = await discoverVendors(query, record(undefined, label), { location: city, maxPlaces: 10, ...deps.vendors }));
  } catch (err) {
    const url = `https://www.google.com/maps/search/${encodeURIComponent(`${query} ${city}`)}`;
    failedRow(job, record(undefined, label), "apify", "directory_listing", url, err);
    return;
  }

  // One page per caterer: its own website. Caterers without one aren't researched.
  const caterers: JobVendor[] = found
    .filter((v) => v.website)
    .slice(0, MAX_CATERERS)
    .map((v) => ({ id: `c_${v.id}`, name: v.name, category: "catering", website: v.website, phone: v.phone, mapsUrl: v.mapsUrl }));
  await researchAll(job, caterers, CATERER_FIELDS, "vendor_site", record, deps);
}

async function researchAll(
  job: JobRecord,
  vendors: JobVendor[],
  fields: readonly FactField[],
  sourceType: "venue_site" | "vendor_site",
  record: Recorder,
  deps: JobDeps,
): Promise<void> {
  if (job.cancelled) return;
  const room = MAX_SOURCES - job.sources.size;
  const queued = vendors.slice(0, Math.max(0, room)).map((vendor) => {
    job.vendors.set(vendor.id, vendor);
    const source = newSource({ url: vendor.website!, provider: "bd_unlocker", sourceType });
    record(vendor.id)(source);
    return { vendor, source };
  });

  let next = 0;
  const worker = async () => {
    while (next < queued.length) {
      const { vendor, source } = queued[next++]!;
      if (job.cancelled) return;
      const onStatus = record(vendor.id);
      let facts: ExtractedFact[];
      try {
        facts = await researchTarget(
          { entity: { id: vendor.id, name: vendor.name, kind: vendor.category === "venue" ? "venue" : "vendor", url: vendor.website }, url: vendor.website!, sourceType, fields, appliesTo: [vendor.id] },
          source,
          onStatus,
          deps,
        );
      } catch (err) {
        // Setup problems (a missing key) throw before any status; show them on the row.
        await onStatus({ ...source, status: "error", attempt: Math.max(1, source.attempt), error: message(err) });
        facts = failedSourceFacts(vendor.id, fields, source.id, [vendor.id]);
      }
      if (!job.cancelled) job.facts.push(...facts);
    }
  };
  await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? 4, queued.length) }, worker));
}

function failedRow(job: JobRecord, onStatus: OnStatus, provider: ResearchSource["provider"], sourceType: ResearchSource["sourceType"], url: string, err: unknown) {
  const source = newSource({ url, provider, sourceType });
  void onStatus({ ...source, status: "error", attempt: 1, error: message(err) });
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function onePerDomain(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    const d = h.domain.replace(/^www\./, "");
    if (seen.has(d)) return false;
    seen.add(d);
    return true;
  });
}

/** Stable per site, so a cached rerun gives the same ids. */
export function vendorIdFor(category: VendorCategory, url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return `${category === "venue" ? "v" : "c"}_${host.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
}

/**
 * "Event Rentals | Palace of Fine Arts" → "Palace of Fine Arts": the title
 * segment that shares the most words with the domain name.
 */
export function nameFromTitle(hit: Pick<SearchHit, "title" | "domain">): string {
  const segments = hit.title.split(/\s+[|–—\-:·•]\s+/).map((s) => s.trim()).filter(Boolean);
  if (segments.length <= 1) return hit.title.trim() || hit.domain;
  const domain = hit.domain.replace(/^www\./, "").split(".")[0]!.toLowerCase();
  const score = (seg: string) => {
    const words = seg.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
    return words.length ? words.filter((w) => domain.includes(w)).length / words.length : 0;
  };
  return segments.reduce((best, seg) => (score(seg) > score(best) ? seg : best), segments[0]!);
}
