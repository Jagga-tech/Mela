import "server-only";
import * as web from "@/mela/contracts";
import { isTerminal, type ExtractedFact, type ResearchSource } from "./contract";
import type { JobRecord, JobVendor } from "./job";
import { MONEY_FIELDS, priceQualifier } from "./verify";

// The research job, in the web app's contract (src/mela/contracts.ts).
// Differences handled here:
//   - money: dollars on the page → integer cents
//   - confidence: price wording ("starting at", "about") → qualifier, decided by code
//   - outside_catering: the web matcher reads it as yes/no ("any" → true)
//   - unknownReason: invalid_value has no web equivalent → quote_mismatch
//   - cached rows: the label says so, with the age of the original fetch

export const LIVE_ORIGIN: web.DataOrigin = {
  mode: "live",
  provider: "bright_data",
  label: "Live public web · Bright Data + Apify · every value quoted from its page",
};

export function toSnapshot(job: JobRecord, now = Date.now()): web.ResearchSnapshot {
  const sources = [...job.sources.values()];
  const byId = new Map(sources.map((s) => [s.id, s]));

  const facts = job.facts.flatMap((f) => {
    const mapped = toWebFact(f, byId.get(f.sourceId ?? ""));
    return mapped ? [mapped] : [];
  });

  // A vendor appears once its page has settled, the same moment its facts do.
  const settled = new Set(
    sources.filter((s) => isTerminal(s.status)).map((s) => job.sourceVendor.get(s.id)).filter((id): id is string => Boolean(id)),
  );
  const vendors = [...job.vendors.values()].filter((v) => settled.has(v.id)).map((v) => toWebVendor(v, job, facts));

  return {
    job: {
      id: job.id,
      briefId: job.brief.id,
      briefVersion: job.brief.version,
      status: jobStatus(job, sources),
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      sources: sources.map((s) => toWebSource(s, job, now)),
      origin: LIVE_ORIGIN,
    },
    vendors,
    facts,
    reviews: [],
  };
}

function jobStatus(job: JobRecord, sources: ResearchSource[]): web.ResearchJob["status"] {
  if (job.cancelled) return "cancelled";
  if (!job.done) return "running";
  if (!sources.some((s) => s.status === "found" || s.status === "partial")) return "failed";
  return sources.every((s) => s.status === "found") ? "complete" : "partial";
}

function toWebSource(s: ResearchSource, job: JobRecord, now: number): web.ResearchSource {
  const query = job.sourceQuery.get(s.id);
  let label = query ?? shortUrl(s.url);
  if (s.fromCache && s.fetchedAt) label += ` · cached, read ${age(now - Date.parse(s.fetchedAt))} ago`;
  return {
    id: s.id,
    url: s.url,
    label,
    provider: s.provider === "open_data" ? "bd_unlocker" : s.provider,
    sourceType: s.sourceType,
    status: s.status,
    fetchedAt: s.fetchedAt,
    latencyMs: s.latencyMs,
    attempt: s.attempt,
    error: s.error,
    vendorId: job.sourceVendor.get(s.id),
  };
}

export function toWebFact(f: ExtractedFact, source: ResearchSource | undefined): web.SourceFact | undefined {
  const field = web.FactField.safeParse(f.field);
  if (!field.success) return undefined; // e.g. application_lead_days: no web field yet

  const base = {
    id: `${f.sourceId ?? "none"}:${f.entityId}:${f.field}`,
    vendorId: f.entityId,
    field: field.data,
    sourceId: f.sourceId,
    url: source?.url,
  };
  if (f.state === "unknown" || f.value === undefined) {
    return { ...base, state: "unknown", unknownReason: f.unknownReason === "invalid_value" ? "quote_mismatch" : (f.unknownReason ?? "not_on_page") };
  }

  let value = f.value;
  let qualifier: web.SourceFact["qualifier"];
  if (MONEY_FIELDS.has(f.field) && typeof value === "number") {
    value = Math.round(value * 100);
    qualifier = priceQualifier(f);
  }
  if (f.field === "outside_catering") value = value === "any";

  return { ...base, state: "verified", value, quote: f.quote, qualifier, retrievedAt: source?.fetchedAt };
}

function toWebVendor(v: JobVendor, job: JobRecord, facts: web.SourceFact[]): web.Vendor {
  const phoneFact = facts.find((f) => f.vendorId === v.id && f.field === "contact_phone" && f.state === "verified");
  let contact: web.VendorContact | undefined;
  if (phoneFact) {
    contact = { phone: String(phoneFact.value), sourceFactId: phoneFact.id, sourceUrl: phoneFact.url, sourceLabel: `Listed on ${shortUrl(phoneFact.url ?? "")}` };
  } else if (v.phone) {
    contact = { phone: v.phone, sourceUrl: v.mapsUrl, sourceLabel: "Google Maps listing (via Apify)" };
  }
  return { id: v.id, name: v.name, category: v.category, area: job.brief.city, website: v.website, contact, fictional: false };
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    const s = `${u.hostname.replace(/^www\./, "")}${path}`;
    return s.length > 56 ? `${s.slice(0, 53)}...` : s;
  } catch {
    return url;
  }
}

function age(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}
