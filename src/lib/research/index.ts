import "server-only";

// Server-side entry point for the research module. Route handlers and the
// research job import from here. Client components import types from
// "./contract" instead, which has no secrets.

export * from "./contract";
export { fetchPage, type FetchPageOptions, type FetchPageResult } from "./fetchPage";
export {
  searchOfficialPages,
  SF_OFFICIAL_DOMAINS,
  type SearchHit,
  type SearchOptions,
  type SearchResult,
} from "./search";
export { brightDataRequest, type BrightDataResponse } from "./brightdata";
export { classifyResponse, type Classification } from "./classify";
export { checkResearchConfig, ConfigError } from "./config";
export { fileCache, memoryCache, type ResearchCache } from "./cache";
export { discoverParks, SF_PARKS_DATASET, type OpenDataPark, type DiscoverParksResult } from "./opendata";
export { failedSourceFacts, fillMissingFields, normalize, verifyFact, type FactCandidate } from "./verify";
export { extractFacts, type ExtractOptions, type ExtractOutcome } from "./extract";
export { discoverVendors, type DiscoverVendorsResult } from "./apify";
export {
  ALL_FIELDS,
  MAX_SOURCES,
  researchTarget,
  runResearch,
  TooManySourcesError,
  type ResearchTarget,
  type RunResearchDeps,
  type RunResearchInput,
} from "./pipeline";
export type { OnStatus } from "./tracked";
