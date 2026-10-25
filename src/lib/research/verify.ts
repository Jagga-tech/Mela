import { z } from "zod";
import { IndoorOutdoor, OutsideCatering, type ExtractedFact, type FactField } from "./contract";

// Verification, in code. The LLM proposes a value plus a verbatim quote; this
// decides whether the page supports it.
//
//   quote missing                      → unknown / not_on_page
//   value has the wrong type           → unknown / invalid_value
//   quote not on the page              → unknown / quote_mismatch
//   quote on page, value literally in it → verified / exact
//   quote on page, value interpreted   → verified / derived
//   free-text value not in the quote   → unknown / quote_mismatch (no "derived" for free text)
//
// A number taken from a range ("100–150 guests" → 150) counts as derived: the
// page doesn't say 150 is the answer, the extractor chose it.

/** What the extractor hands over for one field. Nothing here is trusted yet. */
export interface FactCandidate {
  entityId: string;
  field: FactField;
  value?: unknown;
  quote?: string;
  /** Venue ids this fact covers. A city rule lists only the venues it applies to. */
  appliesTo: string[];
}

const VALUE_SCHEMA: Record<FactField, z.ZodType<number | string | boolean>> = {
  capacity: z.number().int().positive(),
  rental_fee: z.number().nonnegative(),
  application_lead_days: z.number().int().nonnegative(),
  application_fee: z.number().nonnegative(),
  step_free_access: z.boolean(),
  amplified_sound: z.boolean(),
  alcohol: z.boolean(),
  insurance_required: z.boolean(),
  outside_catering: OutsideCatering,
  cleaning_fee: z.number().nonnegative(),
  price_per_guest: z.number().positive(),
  bathrooms: z.boolean(),
  climate_control: z.boolean(),
  indoor_outdoor: IndoorOutdoor,
  style: z.string().trim().min(1).max(80),
  cuisine: z.string().trim().min(1).max(80),
  meat_options: z.boolean(),
  vegetarian_options: z.boolean(),
  service_area: z.string().trim().min(1).max(120),
  contact_phone: z.string().refine((v) => digits(v).length >= 10 && digits(v).length <= 15, "not a phone number"),
};

/**
 * Free text has no interpretation step that code could check, so the value must
 * appear in the quote word for word (a phone number digit for digit).
 */
const LITERAL_ONLY: ReadonlySet<FactField> = new Set(["style", "cuisine", "service_area", "contact_phone"]);

/** Dollar amounts. The web app wants cents and a qualifier for "from about $35". */
export const MONEY_FIELDS: ReadonlySet<FactField> = new Set(["rental_fee", "cleaning_fee", "price_per_guest", "application_fee"]);

/**
 * Makes page text and quotes comparable: lowercase, markdown syntax removed,
 * typographic quotes straightened, whitespace collapsed. Symbols are replaced
 * with spaces before whitespace is collapsed, so "| 150 |" becomes "150".
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) and ![alt](src) → text
    .replace(/<br\s*\/?>/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\\/g, "") // markdown escapes like \$85 or \-
    .replace(/[*#|_`>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function verifyFact(pageMarkdown: string, candidate: FactCandidate, sourceId: string): ExtractedFact {
  const base = { entityId: candidate.entityId, field: candidate.field, sourceId, appliesTo: candidate.appliesTo };

  const quote = candidate.quote ? normalize(candidate.quote) : "";
  if (!quote || candidate.value === undefined || candidate.value === null) {
    return { ...base, state: "unknown", unknownReason: "not_on_page" };
  }

  const parsed = VALUE_SCHEMA[candidate.field].safeParse(candidate.value);
  if (!parsed.success) {
    return { ...base, state: "unknown", unknownReason: "invalid_value" };
  }

  if (!normalize(pageMarkdown).includes(quote)) {
    return { ...base, state: "unknown", unknownReason: "quote_mismatch" };
  }

  const value = parsed.data;
  const literal = candidate.field === "contact_phone" ? digits(quote).includes(digits(String(value))) : appearsLiterally(value, quote);
  if (LITERAL_ONLY.has(candidate.field) && !literal) {
    return { ...base, state: "unknown", unknownReason: "quote_mismatch" };
  }
  return {
    ...base,
    state: "verified",
    value,
    quote: candidate.quote,
    confidence: literal ? "exact" : "derived",
  };
}

/** Every field of an entity whose source failed: unknown / source_failed, never a guess. */
export function failedSourceFacts(
  entityId: string,
  fields: readonly FactField[],
  sourceId: string,
  appliesTo: string[],
): ExtractedFact[] {
  return fields.map((field) => ({ entityId, field, sourceId, appliesTo, state: "unknown", unknownReason: "source_failed" }));
}

/** Fields the extractor didn't return at all become unknown / not_on_page. */
export function fillMissingFields(
  facts: ExtractedFact[],
  entityId: string,
  fields: readonly FactField[],
  sourceId: string,
  appliesTo: string[],
): ExtractedFact[] {
  const have = new Set(facts.filter((f) => f.entityId === entityId).map((f) => f.field));
  const missing: ExtractedFact[] = fields
    .filter((field) => !have.has(field))
    .map((field) => ({ entityId, field, sourceId, appliesTo, state: "unknown", unknownReason: "not_on_page" }));
  return [...facts, ...missing];
}

/**
 * How a verified price is worded. "Starting at $1,100" and "from $35" are floors,
 * "about $40" or a number picked from a range is approximate. Decided by code from
 * the quote, never by the model.
 */
export function priceQualifier(fact: Pick<ExtractedFact, "quote" | "confidence">): "exact" | "approximate" | "starting_at" {
  const q = normalize(fact.quote ?? "");
  if (/\b(start(?:s|ing)? (?:at|from)|from|as low as|minimum|min\.?)\s*\$?\d/.test(q) || /\$?\d[\d,.]*\s*\+/.test(q)) return "starting_at";
  if (/\b(about|approx\.?|approximately|around|roughly|estimated|average)\b|~/.test(q) || fact.confidence === "derived") return "approximate";
  return "exact";
}

const digits = (s: string) => s.replace(/\D/g, "");

function appearsLiterally(value: number | string | boolean, normalizedQuote: string): boolean {
  if (typeof value === "boolean") return false; // "wheelchair accessible" → true is always interpretation
  if (typeof value === "string") return normalizedQuote.includes(normalize(value));

  return standaloneNumbers(normalizedQuote).includes(value);
}

// "1,500" → 1500 and "$85.00" → 85. Numbers on either side of a range
// ("100–150", "100 - 150", "100 to 150") are left out.
const NUMBER = String.raw`\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?`;
const RANGE = new RegExp(`${NUMBER}\\s*(?:-|–|—|to)\\s*${NUMBER}`, "g");
const SINGLE = new RegExp(NUMBER, "g");

function standaloneNumbers(text: string): number[] {
  const withoutRanges = text.replace(RANGE, " ");
  return [...withoutRanges.matchAll(SINGLE)].map((m) => toNumber(m[1]!, m[2]));
}

function toNumber(whole: string, frac?: string): number {
  return Number(`${whole.replace(/,/g, "")}${frac ? `.${frac}` : ""}`);
}
