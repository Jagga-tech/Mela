// Vendor risk level from CRS fields, by fixed rules. No model is involved.
//
//   block   OFAC/sanctions match · bankruptcy on file filed in the last 24 months (or undated)
//   review  no business found · name mismatch · thin file · judgments · tax liens · older bankruptcy
//   clear   all three checks ran, a business matched by name, and nothing above fired
//   not_checked  a check failed or isn't configured, and nothing found blocks
//
// "Business closed" (docs/crs-plan.md) has no field in the documented CRS business
// responses, so no rule reads it. See the report / README note before claiming it.

import type { VendorRisk, VendorRiskCheck, VendorRiskReason } from "@/mela/contracts";
import type { CheckName, CheckOutcome, CreditData, OfacData, SearchData } from "./checks";

export const RULES = {
  /** A bankruptcy filed within this many months (or with no date) blocks; older ones go to review. */
  recentBankruptcyMonths: 24,
  /** Fewer Experian tradelines than this is a thin file. */
  thinFileTradelines: 3,
  /** Results older than this aren't accepted by the payment gate. */
  freshDays: 7,
} as const;

export interface RiskInputs {
  vendorId: string;
  searchedName: string;
  search: CheckOutcome<SearchData>;
  credit: CheckOutcome<CreditData>;
  ofac: CheckOutcome<OfacData>;
  now: Date;
}

export const CRS_ORIGIN = { mode: "live", provider: "crs", label: "CRS sandbox · business checks · level set by code rules" } as const;

export function decideRisk(input: RiskInputs): VendorRisk {
  const reasons: VendorRiskReason[] = [];
  const { search, credit, ofac, now } = input;
  const req = (o: CheckOutcome<unknown>) => ("requestId" in o ? o.requestId : undefined);

  // --- OFAC ---
  if (ofac.status === "ok") {
    const d = ofac.data;
    d.matches.forEach((m, i) => {
      reasons.push({
        code: "ofac_match",
        severity: "block",
        text: `Possible sanctions-list match: "${m.entityName ?? "unnamed entry"}"${m.listName ? ` on ${m.listName}` : ""}${m.entityScore !== undefined ? ` (score ${m.entityScore})` : ""}. Payment is blocked.`,
        source: { check: "ofac", field: `records.resultRecord[0].watchlist.matches.wlmatch[${i}].entityName`, value: m.entityName, requestId: req(ofac) },
      });
    });
    if (d.matches.length === 0 && d.dismissed === 0 && d.hasScreeningListMatches === true) {
      reasons.push({
        code: "ofac_match",
        severity: "block",
        text: "CRS reports a screening-list match but sent no match details. Payment is blocked until someone checks it.",
        source: { check: "ofac", field: "records.resultRecord[0].hasScreeningListMatches", value: true, requestId: req(ofac) },
      });
    }
    if (d.matches.length === 0 && d.dismissed > 0) {
      reasons.push({
        code: "ofac_false_positives",
        severity: "info",
        text: `${d.dismissed} watchlist hit${d.dismissed === 1 ? " was" : "s were"} marked as false positives by the screening service.`,
        source: { check: "ofac", field: "records.resultRecord[0].watchlist.matches.wlmatch[].falsePositive", value: true, requestId: req(ofac) },
      });
    }
    if (d.watchlistStatus === "NO_RESULTS" && d.hasScreeningListMatches !== true) {
      reasons.push({
        code: "ofac_clear",
        severity: "info",
        text: "No OFAC or sanctions-list match for this business name.",
        source: { check: "ofac", field: "records.resultRecord[0].watchlist.status", value: "NO_RESULTS", requestId: req(ofac) },
      });
    }
  }

  // --- business search ---
  let business: VendorRisk["business"] = null;
  if (search.status === "no_match") {
    reasons.push({
      code: "no_business_found",
      severity: "review",
      text: `CRS found no registered business named "${input.searchedName}". It may be a home business; check before paying a deposit.`,
      source: { check: "business_search", field: "data", value: 0, requestId: req(search) },
    });
  } else if (search.status === "ok") {
    const { hit, hitCount } = search.data;
    business = { name: hit.businessName, city: hit.city, state: hit.state };
    if (!namesMatch(input.searchedName, hit.businessName)) {
      reasons.push({
        code: "name_mismatch",
        severity: "review",
        text: `The closest CRS business is "${hit.businessName || "unnamed"}", which doesn't match "${input.searchedName}".`,
        source: { check: "business_search", field: "data[].businessName", value: hit.businessName, requestId: req(search) },
      });
    } else {
      reasons.push({
        code: "business_found",
        severity: "info",
        text: `Business found in CRS (Experian): ${hit.businessName}${hit.city ? `, ${hit.city}` : ""}${hit.state ? ` ${hit.state}` : ""}${hitCount > 1 ? ` (best of ${hitCount} matches)` : ""}.`,
        source: { check: "business_search", field: "data[].businessName", value: hit.businessName, requestId: req(search) },
      });
    }
    if (hit.numberOfTradelines !== undefined && hit.numberOfTradelines < RULES.thinFileTradelines) {
      reasons.push({
        code: "thin_file",
        severity: "review",
        text: `Thin credit file: ${hit.numberOfTradelines} trade line${hit.numberOfTradelines === 1 ? "" : "s"} on record.`,
        source: { check: "business_search", field: "data[].numberOfTradelines", value: hit.numberOfTradelines, requestId: req(search) },
      });
    }
  }

  // --- business credit / public records ---
  if (credit.status === "ok") {
    const c = credit.data;
    const r = req(credit);
    const bankrupt = c.bankruptcyIndicator === true || (c.bankruptcyCount ?? 0) > 0;
    if (bankrupt) {
      const filed = parseCrsDate(c.mostRecentBankruptcyDate);
      const recent = !filed || monthsBetween(filed, now) < RULES.recentBankruptcyMonths;
      const field = c.bankruptcyCount !== undefined ? "data.executiveElements.bankruptcyCount" : "data.executiveElements.bankruptcyIndicator";
      reasons.push({
        code: recent ? "bankruptcy_recent" : "bankruptcy_past",
        severity: recent ? "block" : "review",
        text: recent
          ? `Bankruptcy on file${c.mostRecentBankruptcyDate ? `, most recent ${c.mostRecentBankruptcyDate}` : " (no filing date given)"}. Payment is blocked.`
          : `Past bankruptcy on file, most recent ${c.mostRecentBankruptcyDate}. Review before paying a deposit.`,
        source: { check: "business_credit", field, value: c.bankruptcyCount ?? c.bankruptcyIndicator, requestId: r },
      });
    }
    if (c.judgmentIndicator === true || (c.judgmentCount ?? 0) > 0) {
      reasons.push({
        code: "judgments_on_file",
        severity: "review",
        text: `${c.judgmentCount ?? "One or more"} judgment${c.judgmentCount === 1 ? "" : "s"} on file${c.judgmentBalance ? ` totalling $${c.judgmentBalance.toLocaleString("en-US")}` : ""}${c.mostRecentJudgmentDate ? `, most recent ${c.mostRecentJudgmentDate}` : ""}.`,
        source: { check: "business_credit", field: c.judgmentCount !== undefined ? "data.executiveElements.judgmentCount" : "data.executiveElements.judgmentIndicator", value: c.judgmentCount ?? true, requestId: r },
      });
    }
    if (c.taxLienIndicator === true || (c.taxLienCount ?? 0) > 0) {
      reasons.push({
        code: "tax_liens_on_file",
        severity: "review",
        text: `${c.taxLienCount ?? "One or more"} tax lien${c.taxLienCount === 1 ? "" : "s"} on file${c.lienBalance ? ` totalling $${c.lienBalance.toLocaleString("en-US")}` : ""}${c.mostRecentTaxLienDate ? `, most recent ${c.mostRecentTaxLienDate}` : ""}.`,
        source: { check: "business_credit", field: c.taxLienCount !== undefined ? "data.executiveElements.taxLienCount" : "data.executiveElements.taxLienIndicator", value: c.taxLienCount ?? true, requestId: r },
      });
    }
    if (!bankrupt && !(c.judgmentIndicator === true || (c.judgmentCount ?? 0) > 0) && !(c.taxLienIndicator === true || (c.taxLienCount ?? 0) > 0)) {
      reasons.push({
        code: "no_public_records",
        severity: "info",
        text: "No bankruptcies, judgments or tax liens on file.",
        source: { check: "business_credit", field: "data.executiveElements.bankruptcyCount", value: c.bankruptcyCount ?? 0, requestId: r },
      });
    }
    const since = c.fileEstablishDate ?? c.yearOfIncorporation;
    if (since && business) {
      business = { ...business, onFileSince: since };
      reasons.push({
        code: "on_file_since",
        severity: "info",
        text: c.yearOfIncorporation ? `Incorporated ${c.yearOfIncorporation}.` : `On file with Experian since ${c.fileEstablishDate}.`,
        source: {
          check: "business_credit",
          field: c.yearOfIncorporation ? "data.executiveElements.yearOfIncorporation" : "data.businessNameAndAddress[0].fileEstablishDate",
          value: since,
          requestId: r,
        },
      });
    }
  }

  const checks: VendorRiskCheck[] = (
    [
      ["business_search", search],
      ["business_credit", credit],
      ["ofac", ofac],
    ] as [CheckName, CheckOutcome<unknown>][]
  ).map(([check, o]) => ({
    check,
    status: o.status,
    detail: "detail" in o ? o.detail : undefined,
    requestId: req(o),
    latencyMs: "latencyMs" in o ? o.latencyMs : undefined,
    attempts: "attempts" in o ? o.attempts : 0,
  }));

  const failures = checks.filter((c) => c.status === "error" || c.status === "not_configured");
  const hasBlock = reasons.some((r) => r.severity === "block");
  const hasReview = reasons.some((r) => r.severity === "review");

  let status: VendorRisk["status"] = "checked";
  let level: VendorRisk["level"];
  let notCheckedReason: string | undefined;
  if (hasBlock) {
    level = "block"; // a definite finding stands even if another check failed
  } else if (failures.length > 0) {
    status = "not_checked";
    level = null;
    notCheckedReason = failures.map((f) => `${CHECK_LABEL[f.check]}: ${f.detail ?? f.status}`).join(" ");
  } else {
    level = hasReview ? "review" : "clear";
  }

  const freshUntil = new Date(now.getTime() + RULES.freshDays * 86_400_000);
  return {
    vendorId: input.vendorId,
    status,
    level,
    reasons,
    checks,
    business,
    searchedName: input.searchedName,
    notCheckedReason,
    checkedAt: now.toISOString(),
    freshUntil: freshUntil.toISOString(),
    origin: { ...CRS_ORIGIN },
  };
}

export const CHECK_LABEL: Record<CheckName, string> = {
  business_search: "Business lookup",
  business_credit: "Business credit and public records",
  ofac: "OFAC screen",
};

const SUFFIXES = new Set(["inc", "incorporated", "llc", "l", "c", "co", "corp", "corporation", "company", "ltd", "limited", "the", "dba", "pllc", "lp", "llp", "pc"]);

export function normalizeName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !SUFFIXES.has(t));
}

/** Same tokens, or every token of the shorter name appears in the longer one. */
export function namesMatch(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (x.length === 0 || y.length === 0) return false;
  const [short, long] = x.length <= y.length ? [x, new Set(y)] : [y, new Set(x)];
  return short.every((t) => long.has(t));
}

/** ISO (2024-03-01), US (03/01/2024) or compact (20240301). Anything else → undefined. */
export function parseCrsDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return utc(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return utc(+m[3]!, +m[1]!, +m[2]!);
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return utc(+m[1]!, +m[2]!, +m[3]!);
  return undefined;
}

function utc(y: number, mo: number, d: number): Date | undefined {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return new Date(Date.UTC(y, mo - 1, d));
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}
