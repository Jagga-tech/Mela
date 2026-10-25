// The shared data contract for research results.
//
// Safe to import from client code (the dashboard): no secrets, no server-only
// imports. Teammates should import types from here, e.g.
//   import type { ResearchSource } from "@/lib/research/contract";

import { z } from "zod";

export const MAX_ATTEMPTS = 2;

export const SourceStatus = z.enum([
  "queued",
  "searching",
  "fetching",
  "extracting",
  "slow", // soft timeout hit, request still in flight
  "found",
  "partial",
  "empty",
  "blocked",
  "error",
]);
export type SourceStatus = z.infer<typeof SourceStatus>;

/** Statuses after which a source will not change again (until a manual re-run). */
export const TERMINAL_STATUSES = ["found", "partial", "empty", "blocked", "error"] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export function isTerminal(status: SourceStatus): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

// open_data = a city's public Socrata API (e.g. DataSF), fetched directly. Used for
// facility discovery because Bright Data refuses government domains by policy.
export const Provider = z.enum(["bd_serp", "bd_unlocker", "apify", "open_data"]);
export type Provider = z.infer<typeof Provider>;

export const SourceType = z.enum(["official_city", "venue_site", "vendor_site", "directory_listing"]);
export type SourceType = z.infer<typeof SourceType>;

export const ResearchSource = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  provider: Provider,
  sourceType: SourceType,
  status: SourceStatus,
  fetchedAt: z.string().datetime().optional(), // ISO timestamp, set when content arrives
  latencyMs: z.number().nonnegative().optional(), // latency of the latest attempt
  attempt: z.number().int().min(0).max(MAX_ATTEMPTS), // 0 while queued, then 1 or 2
  error: z.string().optional(), // why it failed, or why it is retrying
  // True when this result was served from the research cache. fetchedAt is then
  // the time of the original live fetch, so the dashboard can show its age.
  fromCache: z.boolean().optional(),
});
export type ResearchSource = z.infer<typeof ResearchSource>;

export const FactField = z.enum([
  "capacity",
  "rental_fee",
  "application_lead_days",
  "application_fee",
  "step_free_access",
  "amplified_sound",
  "alcohol",
  "insurance_required",
  "outside_catering", // "any" | "approved_list_only" | "in_house_only"
  // Fields the web app's matcher reads (src/mela/domain/match.ts).
  "cleaning_fee",
  "price_per_guest",
  "bathrooms",
  "climate_control",
  "indoor_outdoor", // "indoor" | "outdoor" | "indoor and outdoor"
  "style",
  "cuisine",
  "meat_options",
  "vegetarian_options",
  "service_area",
  "contact_phone",
]);
export type FactField = z.infer<typeof FactField>;

/** Allowed values for the outside_catering field. */
export const OutsideCatering = z.enum(["any", "approved_list_only", "in_house_only"]);
export type OutsideCatering = z.infer<typeof OutsideCatering>;

/** Allowed values for indoor_outdoor. "indoor and outdoor" contains both words, so either preference matches it. */
export const IndoorOutdoor = z.enum(["indoor", "outdoor", "indoor and outdoor"]);
export type IndoorOutdoor = z.infer<typeof IndoorOutdoor>;

export const ExtractedFact = z.object({
  entityId: z.string().min(1), // venue or vendor
  field: FactField,
  state: z.enum(["verified", "unknown"]),
  value: z.union([z.number(), z.string(), z.boolean()]).optional(),
  sourceId: z.string().optional(),
  quote: z.string().optional(), // verbatim from the fetched page
  confidence: z.enum(["exact", "derived"]).optional(), // set by code, never by the LLM
  // invalid_value: the extractor returned the wrong type for the field (e.g. "lots" for capacity).
  unknownReason: z.enum(["not_on_page", "quote_mismatch", "source_failed", "invalid_value"]).optional(),
  appliesTo: z.array(z.string()), // venue ids this rule covers
});
export type ExtractedFact = z.infer<typeof ExtractedFact>;

/** A venue or rule-setting authority that facts are about, so the UI can show names for entityIds. */
export const ResearchEntity = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["venue", "vendor", "authority"]),
  url: z.string().optional(),
});
export type ResearchEntity = z.infer<typeof ResearchEntity>;

/** A public local vendor (caterer, florist, ...) found through Apify's Google Places crawler. */
export const Vendor = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional(),
  website: z.string().optional(),
  mapsUrl: z.string().optional(), // the public listing this record came from
  address: z.string().optional(),
  phone: z.string().optional(),
  rating: z.number().optional(),
  reviewsCount: z.number().int().optional(),
  sourceId: z.string().min(1), // the apify ResearchSource that found it
});
export type Vendor = z.infer<typeof Vendor>;

export const ResearchResult = z.object({
  eventId: z.string().min(1),
  sources: z.array(ResearchSource),
  facts: z.array(ExtractedFact),
  entities: z.array(ResearchEntity).optional(),
  vendors: z.array(Vendor).optional(),
});
export type ResearchResult = z.infer<typeof ResearchResult>;

/** Create a new source row in the "queued" state. Store it before starting work on it. */
export function newSource(init: {
  url: string;
  provider: Provider;
  sourceType: SourceType;
  id?: string;
}): ResearchSource {
  return {
    id: init.id ?? globalThis.crypto.randomUUID(),
    url: init.url,
    provider: init.provider,
    sourceType: init.sourceType,
    status: "queued",
    attempt: 0,
  };
}
