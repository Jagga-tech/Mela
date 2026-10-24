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

export const Provider = z.enum(["bd_serp", "bd_unlocker", "apify"]);
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
]);
export type FactField = z.infer<typeof FactField>;

export const ExtractedFact = z.object({
  entityId: z.string().min(1), // venue or vendor
  field: FactField,
  state: z.enum(["verified", "unknown"]),
  value: z.union([z.number(), z.string(), z.boolean()]).optional(),
  sourceId: z.string().optional(),
  quote: z.string().optional(), // verbatim from the fetched page
  confidence: z.enum(["exact", "derived"]).optional(), // set by code, never by the LLM
  unknownReason: z.enum(["not_on_page", "quote_mismatch", "source_failed"]).optional(),
  appliesTo: z.array(z.string()), // venue ids this rule covers
});
export type ExtractedFact = z.infer<typeof ExtractedFact>;

export const ResearchResult = z.object({
  eventId: z.string().min(1),
  sources: z.array(ResearchSource),
  facts: z.array(ExtractedFact),
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
