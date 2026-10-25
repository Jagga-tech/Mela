// The three CRS business checks Mela runs, and the parsers that keep only the
// fields the risk rules read. Raw responses are never stored or logged.
//
// Request/response shapes are from CRS's published OpenAPI ("eCredit Data API",
// https://crscreditapi.redoc.ly/openapi/reference/tag/Experian/ and .../tag/LexisNexis/):
//   business_search  POST /ccc/exp/search      Experian Business Search (operation Experian-07)
//   business_credit  POST /ccc/exp/score       Experian Intelliscore+ Business Report (Experian-08)
//   ofac             POST /xgs/search/{config} LexisNexis Bridger Insight XG (LexisNexis-12)
//
// Not used, on purpose (docs/crs-plan.md): consumer credit reports, criminal,
// eviction, consumer identity. Only business fields are ever sent.

import type { CrsCallResult, CrsClient } from "./client";

export type CheckName = "business_search" | "business_credit" | "ofac";

/** What Mela knows about a vendor's business. No personal data: no owner names, SSNs or birth dates. */
export interface BusinessIdentity {
  name: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
}

export type CheckOutcome<T> =
  | { status: "ok"; data: T; requestId?: string; latencyMs: number; attempts: number }
  | { status: "no_match"; requestId?: string; latencyMs: number; attempts: number }
  | { status: "error"; detail: string; requestId?: string; latencyMs: number; attempts: number }
  | { status: "not_configured"; detail: string }
  | { status: "skipped"; detail: string };

// ---------- business search (Experian) ----------

export interface SearchHit {
  bin: string;
  businessName: string;
  reliabilityCode?: number;
  numberOfTradelines?: number;
  city?: string;
  state?: string;
}

export interface SearchData {
  hit: SearchHit;
  /** How many businesses CRS returned; the rules use the best one. */
  hitCount: number;
}

export function businessSearchBody(b: BusinessIdentity): Record<string, string> {
  const body: Record<string, string> = { name: b.name };
  for (const k of ["street", "city", "state", "zip", "phone"] as const) {
    const v = b[k]?.trim();
    if (v) body[k] = v;
  }
  return body;
}

export function parseBusinessSearch(body: unknown): { kind: "hits"; data: SearchData } | { kind: "none" } | { kind: "bad"; detail: string } {
  const data = (body as { data?: unknown } | null)?.data;
  if (data === undefined || data === null) return { kind: "bad", detail: "CRS business search answered without a `data` list." };
  if (!Array.isArray(data)) return { kind: "bad", detail: "CRS business search `data` isn't a list." };
  const hits: SearchHit[] = data.flatMap((d) => {
    const r = d as Record<string, unknown>;
    if (typeof r?.bin !== "string" || !r.bin) return [];
    const address = (r.address ?? {}) as Record<string, unknown>;
    return [
      {
        bin: r.bin,
        businessName: typeof r.businessName === "string" ? r.businessName : "",
        reliabilityCode: num(r.reliabilityCode),
        numberOfTradelines: num(r.numberOfTradelines),
        city: str(address.city),
        state: str(address.state),
      },
    ];
  });
  if (hits.length === 0) return { kind: "none" };
  // Highest reliability first; CRS order breaks ties.
  const best = hits.reduce((a, b) => ((b.reliabilityCode ?? -1) > (a.reliabilityCode ?? -1) ? b : a));
  return { kind: "hits", data: { hit: best, hitCount: hits.length } };
}

// ---------- business credit + public records (Experian Intelliscore+) ----------

/** Fields from `data.executiveElements` and `data.businessNameAndAddress[0]`, nothing else. */
export interface CreditData {
  bankruptcyIndicator?: boolean;
  bankruptcyCount?: number;
  mostRecentBankruptcyDate?: string;
  judgmentIndicator?: boolean;
  judgmentCount?: number;
  mostRecentJudgmentDate?: string;
  judgmentBalance?: number;
  taxLienIndicator?: boolean;
  taxLienCount?: number;
  mostRecentTaxLienDate?: string;
  lienBalance?: number;
  yearOfIncorporation?: string;
  fileEstablishDate?: string;
}

export function parseBusinessCredit(body: unknown): { kind: "ok"; data: CreditData } | { kind: "bad"; detail: string } {
  const data = (body as { data?: unknown } | null)?.data as Record<string, unknown> | undefined;
  const ee = data?.executiveElements as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object" || !ee || typeof ee !== "object") {
    return { kind: "bad", detail: "CRS business credit answered without `data.executiveElements`." };
  }
  const header = Array.isArray(data.businessNameAndAddress) ? (data.businessNameAndAddress[0] as Record<string, unknown> | undefined) : undefined;
  return {
    kind: "ok",
    data: {
      bankruptcyIndicator: bool(ee.bankruptcyIndicator),
      bankruptcyCount: num(ee.bankruptcyCount),
      mostRecentBankruptcyDate: str(ee.mostRecentBankruptcyDate),
      judgmentIndicator: bool(ee.judgmentIndicator),
      judgmentCount: num(ee.judgmentCount),
      mostRecentJudgmentDate: str(ee.mostRecentJudgmentDate),
      judgmentBalance: num(ee.judgmentBalance),
      taxLienIndicator: bool(ee.taxLienIndicator),
      taxLienCount: num(ee.taxLienCount),
      mostRecentTaxLienDate: str(ee.mostRecentTaxLienDate),
      lienBalance: num(ee.lienBalance),
      yearOfIncorporation: str(ee.yearOfIncorporation),
      fileEstablishDate: str(header?.fileEstablishDate),
    },
  };
}

// ---------- OFAC / sanctions (LexisNexis Bridger Insight XG) ----------

export interface OfacConfig {
  /** `{config}` path segment. CRS assigns it; there is no documented sandbox default. */
  config: string;
  /** Required by the spec. Values are permissible-purpose codes CRS must confirm. */
  glbPurpose: string;
  dlPurpose: string;
  /** Optional; the spec allows "NMS_PEP_OFAC_SANC" or "List Screening". */
  searchType?: string;
}

export interface OfacMatch {
  entityName?: string;
  listName?: string;
  entityScore?: number;
  reasonListed?: string;
}

export interface OfacData {
  /** `records.resultRecord[0].watchlist.status`. */
  watchlistStatus: "NO_RESULTS" | "RESULTS";
  hasScreeningListMatches?: boolean;
  /** Matches not marked falsePositive / autoFalsePositive by Bridger. */
  matches: OfacMatch[];
  /** Matches Bridger itself marked as false positives. Shown as info, never a block. */
  dismissed: number;
}

export function ofacBody(b: BusinessIdentity, cfg: OfacConfig): Record<string, unknown> {
  const address: Record<string, string> = { type: "CURRENT", country: "US" };
  if (b.street) address.street1 = b.street;
  if (b.city) address.city = b.city;
  if (b.state) address.stateProvinceDistrict = b.state;
  if (b.zip) address.postalCode = b.zip;
  const body: Record<string, unknown> = {
    glbPurpose: cfg.glbPurpose,
    dlPurpose: cfg.dlPurpose,
    input: {
      records: {
        inputRecord: [
          {
            recordID: 1,
            entity: {
              entityType: "BUSINESS",
              name: { full: b.name },
              addresses: { inputAddress: [address] },
            },
          },
        ],
      },
    },
  };
  if (cfg.searchType) body.searchType = cfg.searchType;
  return body;
}

export function parseOfac(body: unknown): { kind: "ok"; data: OfacData } | { kind: "bad"; detail: string } {
  const recs = (body as { records?: { resultRecord?: unknown } } | null)?.records?.resultRecord;
  const first = (Array.isArray(recs) ? recs[0] : recs) as Record<string, unknown> | undefined;
  const wl = first?.watchlist as Record<string, unknown> | undefined;
  const status = wl?.status;
  if (!first || !wl) return { kind: "bad", detail: "CRS OFAC screen answered without `records.resultRecord[].watchlist`." };
  if (status === "NOT_SEARCHED") return { kind: "bad", detail: "CRS OFAC screen says the watchlist was NOT_SEARCHED." };
  if (status !== "NO_RESULTS" && status !== "RESULTS") return { kind: "bad", detail: "CRS OFAC screen returned an unknown watchlist status." };

  const raw = (wl.matches as { wlmatch?: unknown } | undefined)?.wlmatch;
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
  const live = list.filter((m) => m.falsePositive !== true && m.autoFalsePositive !== true);
  return {
    kind: "ok",
    data: {
      watchlistStatus: status,
      hasScreeningListMatches: bool(first.hasScreeningListMatches),
      matches: live.map((m) => ({
        entityName: str(m.entityName) ?? str(m.bestName),
        listName: str((m.file as Record<string, unknown> | undefined)?.name),
        entityScore: num(m.entityScore),
        reasonListed: str(m.reasonListed)?.slice(0, 120),
      })),
      dismissed: list.length - live.length,
    },
  };
}

// ---------- running them ----------

export async function runBusinessSearch(client: CrsClient, b: BusinessIdentity): Promise<CheckOutcome<SearchData>> {
  const r = await client.post("/ccc/exp/search", businessSearchBody(b), "business_search");
  if (!r.ok) return failed(r);
  const parsed = parseBusinessSearch(r.body);
  if (parsed.kind === "bad") return { status: "error", detail: parsed.detail, requestId: r.requestId, latencyMs: r.latencyMs, attempts: r.attempts };
  if (parsed.kind === "none") return { status: "no_match", requestId: r.requestId, latencyMs: r.latencyMs, attempts: r.attempts };
  return { status: "ok", data: parsed.data, requestId: r.requestId, latencyMs: r.latencyMs, attempts: r.attempts };
}

export async function runBusinessCredit(client: CrsClient, bin: string): Promise<CheckOutcome<CreditData>> {
  const r = await client.post("/ccc/exp/score", { bin }, "business_credit");
  if (!r.ok) return failed(r);
  const parsed = parseBusinessCredit(r.body);
  if (parsed.kind === "bad") return { status: "error", detail: parsed.detail, requestId: r.requestId, latencyMs: r.latencyMs, attempts: r.attempts };
  return { status: "ok", data: parsed.data, requestId: r.requestId, latencyMs: r.latencyMs, attempts: r.attempts };
}

export async function runOfac(client: CrsClient, b: BusinessIdentity, cfg: OfacConfig | null): Promise<CheckOutcome<OfacData>> {
  if (!cfg) {
    return { status: "not_configured", detail: "OFAC screening isn't set up: CRS_XGS_CONFIG, CRS_XGS_GLB_PURPOSE and CRS_XGS_DL_PURPOSE are needed from the CRS team." };
  }
  const r = await client.post(`/xgs/search/${encodeURIComponent(cfg.config)}`, ofacBody(b, cfg), "ofac");
  if (!r.ok) return failed(r);
  const parsed = parseOfac(r.body);
  if (parsed.kind === "bad") return { status: "error", detail: parsed.detail, requestId: r.requestId, latencyMs: r.latencyMs, attempts: r.attempts };
  return { status: "ok", data: parsed.data, requestId: r.requestId, latencyMs: r.latencyMs, attempts: r.attempts };
}

function failed(r: Extract<CrsCallResult, { ok: false }>): { status: "error"; detail: string; requestId?: string; latencyMs: number; attempts: number } {
  return { status: "error", detail: r.message, requestId: r.requestId, latencyMs: r.latencyMs, attempts: r.attempts };
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : v === "true" || v === "Y" ? true : v === "false" || v === "N" ? false : undefined);
