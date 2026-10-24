// Deterministic requirement matching. No model output is trusted here: every result
// points at the SourceFact ids it was computed from, and missing facts stay unknown.
import type { BudgetLine, EventBrief, EventRequirement, FactField, PriceEvidence, Recommendation, RequirementCheck, SourceFact, Vendor } from "../contracts";
import { usd } from "./util";

const BOOL_FIELD: Partial<Record<EventRequirement["key"], FactField>> = {
  bathrooms: "bathrooms",
  climate_control: "climate_control",
  outside_catering: "outside_catering",
  alcohol_allowed: "alcohol",
  step_free_access: "step_free_access",
  meat_options: "meat_options",
  vegetarian_options: "vegetarian_options",
};

const factFor = (facts: SourceFact[], vendorId: string, field: FactField) =>
  facts.filter((f) => f.vendorId === vendorId && f.field === field);

/** Collapse several facts for one field: any conflict or disagreement → conflicting; no verified → unknown. */
function resolve(fs: SourceFact[]): { state: "verified" | "unknown" | "conflicting"; value?: SourceFact["value"]; ids: string[]; fact?: SourceFact } {
  const ids = fs.map((f) => f.id);
  if (fs.some((f) => f.state === "conflicting")) return { state: "conflicting", ids };
  const verified = fs.filter((f) => f.state === "verified" && f.value !== undefined);
  if (!verified.length) return { state: "unknown", ids, fact: fs[0] };
  const values = new Set(verified.map((f) => JSON.stringify(f.value)));
  if (values.size > 1) return { state: "conflicting", ids };
  return { state: "verified", value: verified[0].value, ids, fact: verified[0] };
}

export function priceFor(brief: EventBrief, vendor: Vendor, facts: SourceFact[]): PriceEvidence {
  if (vendor.category === "venue") {
    const rent = resolve(factFor(facts, vendor.id, "rental_fee"));
    const clean = resolve(factFor(facts, vendor.id, "cleaning_fee"));
    if (rent.state !== "verified" || typeof rent.value !== "number")
      return { priceType: "unknown", amountCents: null, unit: "unknown", unitCents: null, note: "No published rental price found", factIds: rent.ids };
    const extra = clean.state === "verified" && typeof clean.value === "number" ? clean.value : 0;
    const exact = rent.fact?.qualifier === undefined || rent.fact.qualifier === "exact";
    return {
      priceType: exact ? "published" : "estimated",
      amountCents: rent.value + extra,
      unit: "flat",
      unitCents: rent.value,
      note: `${exact ? "" : "From about "}${usd(rent.value)} rental${extra ? ` + ${usd(extra)} cleaning` : ""}${clean.state === "unknown" ? " · other fees unknown" : ""}`,
      factIds: [...rent.ids, ...clean.ids],
    };
  }
  const per = resolve(factFor(facts, vendor.id, "price_per_guest"));
  if (per.state !== "verified" || typeof per.value !== "number")
    return { priceType: "unknown", amountCents: null, unit: "per_guest", unitCents: null, note: "Price not published — ask for a quote", factIds: per.ids };
  const exact = per.fact?.qualifier === undefined || per.fact.qualifier === "exact";
  const guests = brief.guestRange?.max ?? null;
  return {
    priceType: exact ? "published" : "estimated",
    amountCents: guests === null ? null : per.value * guests,
    unit: "per_guest",
    unitCents: per.value,
    note: `${exact ? "" : "~"}${usd(per.value)}/guest${guests ? ` × ${guests} ≈ ${usd(per.value * guests)}` : ""}${exact ? "" : " (estimate)"}`,
    factIds: per.ids,
  };
}

export function checkRequirement(brief: EventBrief, vendor: Vendor, facts: SourceFact[], req: EventRequirement): RequirementCheck {
  const base = { requirementId: req.id, label: req.label, priority: req.priority };
  if (req.appliesTo !== vendor.category) return { ...base, result: "not_applicable", factIds: [], note: "Not checked for this category" };

  const boolField = BOOL_FIELD[req.key];
  if (boolField) {
    const r = resolve(factFor(facts, vendor.id, boolField));
    if (r.state === "conflicting") return { ...base, result: "conflicting", factIds: r.ids, note: "Sources disagree — ask" };
    if (r.state === "unknown") return { ...base, result: "unknown", factIds: r.ids, note: "Not stated on the source — ask" };
    return r.value === true
      ? { ...base, result: "meets", factIds: r.ids, note: r.fact?.quote ?? "Stated on the source" }
      : { ...base, result: "violates", factIds: r.ids, note: r.fact?.quote ?? "Source says no" };
  }

  switch (req.key) {
    case "capacity": {
      const r = resolve(factFor(facts, vendor.id, "capacity"));
      if (r.state === "conflicting") return { ...base, result: "conflicting", factIds: r.ids, note: "Capacity differs between sources" };
      if (r.state !== "verified" || typeof r.value !== "number") return { ...base, result: "unknown", factIds: r.ids, note: "Capacity not published" };
      const need = Number(req.value);
      return r.value >= need
        ? { ...base, result: "meets", factIds: r.ids, note: `Holds ${r.value}` }
        : { ...base, result: "violates", factIds: r.ids, note: `Holds ${r.value}, you need ${need}` };
    }
    case "venue_budget": {
      const p = priceFor(brief, vendor, facts);
      if (p.amountCents === null) return { ...base, result: "unknown", factIds: p.factIds, note: "No published price to check against your cap" };
      const cap = Number(req.value);
      // a cap is only "met" when every fee is known; a cheap rental with unknown fees still needs asking
      const feesKnown = resolve(factFor(facts, vendor.id, "cleaning_fee")).state === "verified";
      if (p.amountCents <= cap)
        return p.priceType === "published" && feesKnown
          ? { ...base, result: "meets", factIds: p.factIds, note: `${p.note} ≤ ${usd(cap)}` }
          : { ...base, result: "unknown", factIds: p.factIds, note: `${usd(p.amountCents)} ≤ ${usd(cap)} so far, but other fees are unknown — ask` };
      return { ...base, result: "violates", factIds: p.factIds, note: `${usd(p.amountCents)} is over your ${usd(cap)} venue cap` };
    }
    case "cuisine":
    case "style":
    case "indoor_outdoor": {
      const field: FactField = req.key === "cuisine" ? "cuisine" : req.key === "style" ? "style" : "indoor_outdoor";
      if (req.key === "indoor_outdoor" && req.priority === "FLEXIBLE") return { ...base, result: "not_applicable", factIds: [], note: "You're flexible on this" };
      const r = resolve(factFor(facts, vendor.id, field));
      if (r.state !== "verified") return { ...base, result: r.state === "conflicting" ? "conflicting" : "unknown", factIds: r.ids, note: "Not stated on the source" };
      const ok = String(r.value).toLowerCase().includes(String(req.value).toLowerCase()) || req.value === "either";
      return { ...base, result: ok ? "meets" : "violates", factIds: r.ids, note: r.fact?.quote ?? String(r.value) };
    }
    default:
      return { ...base, result: "unknown", factIds: [], note: "Mela can't check this automatically — ask" };
  }
}

export function evaluateVendor(brief: EventBrief, vendor: Vendor, facts: SourceFact[]): Recommendation {
  const checks = brief.requirements.filter((r) => r.appliesTo === vendor.category).map((r) => checkRequirement(brief, vendor, facts, r));
  const must = checks.filter((c) => c.priority === "MUST_HAVE");
  const matchStatus = must.some((c) => c.result === "violates")
    ? "excluded"
    : must.some((c) => c.result !== "meets")
      ? "possible_match"
      : "verified_match";
  const applicable = checks.filter((c) => c.result !== "not_applicable");
  return {
    vendorId: vendor.id,
    category: vendor.category,
    matchStatus,
    labels: [],
    checks,
    reasons: applicable.filter((c) => c.result === "meets" && c.priority !== "FLEXIBLE").map((c) => `${c.label} — ${c.note}`),
    tradeoffs: applicable.filter((c) => c.priority !== "MUST_HAVE" && c.result === "violates").map((c) => `${c.label}: ${c.note}`),
    unknowns: applicable.filter((c) => c.result === "unknown" || c.result === "conflicting").map((c) => `${c.label}: ${c.note}`),
    price: priceFor(brief, vendor, facts),
  };
}

const score = (r: Recommendation) =>
  r.checks.reduce((s, c) => s + (c.result === "meets" ? (c.priority === "MUST_HAVE" ? 3 : c.priority === "PREFERENCE" ? 2 : 0) : c.result === "violates" && c.priority === "PREFERENCE" ? -1 : 0), 0);

/** Rank one category. Labels only appear when the evidence supports them; there is no fit percentage. */
export function rankCategory(brief: EventBrief, vendors: Vendor[], facts: SourceFact[]): Recommendation[] {
  const recs = vendors.map((v) => evaluateVendor(brief, v, facts));
  const order = { verified_match: 0, possible_match: 1, excluded: 2 } as const;
  recs.sort((a, b) => order[a.matchStatus] - order[b.matchStatus] || score(b) - score(a) || (a.price.amountCents ?? Infinity) - (b.price.amountCents ?? Infinity));

  const live = recs.filter((r) => r.matchStatus !== "excluded");
  const best = live.find((r) => r.matchStatus === "verified_match");
  if (best) best.labels.push("best_fit");

  const published = live.filter((r) => r.price.priceType === "published" && r.price.amountCents !== null);
  if (published.length >= 2) {
    const low = published.reduce((a, b) => (b.price.amountCents! < a.price.amountCents! ? b : a));
    low.labels.push("lowest_published_estimate");
  }
  if (best && best.price.amountCents !== null) {
    const trade = live.find((r) => r !== best && !r.labels.length && r.price.amountCents !== null && r.price.amountCents < best.price.amountCents!);
    if (trade) trade.labels.push("best_tradeoff");
  }
  return recs;
}

/** Up to three candidates per category; vendors with no verified fact at all are "couldn't check", never candidates. */
export function shortlist(recs: Recommendation[], facts: SourceFact[], limit = 3) {
  const checked = (id: string) => facts.some((f) => f.vendorId === id && f.state === "verified");
  const usable = recs.filter((r) => checked(r.vendorId));
  const candidates = usable.filter((r) => r.matchStatus !== "excluded");
  return {
    top: candidates.slice(0, limit),
    more: candidates.slice(limit),
    excluded: usable.filter((r) => r.matchStatus === "excluded"),
    unchecked: recs.filter((r) => !checked(r.vendorId)),
  };
}

export function budgetLines(brief: EventBrief, picks: { venue?: Recommendation; catering?: Recommendation }): BudgetLine[] {
  const cap = brief.budget.amountCents;
  const none: PriceEvidence = { priceType: "unknown", amountCents: null, unit: "unknown", unitCents: null, note: "Nothing chosen yet", factIds: [] };
  const venuePrice = picks.venue?.price ?? none;
  const cateringPrice = picks.catering?.price ?? none;
  if (brief.budget.scope === "venue_only") {
    return [
      { category: "venue", label: "Venue", capCents: cap, price: venuePrice, remainingCents: cap !== null && venuePrice.amountCents !== null ? cap - venuePrice.amountCents : null },
      { category: "catering", label: "Catering (separate from the venue cap)", capCents: null, price: cateringPrice, remainingCents: null },
    ];
  }
  const known = [venuePrice, cateringPrice].every((p) => p.amountCents !== null);
  const total = known ? venuePrice.amountCents! + cateringPrice.amountCents! : null;
  return [
    { category: "venue", label: "Venue", capCents: null, price: venuePrice, remainingCents: null },
    { category: "catering", label: "Catering", capCents: null, price: cateringPrice, remainingCents: cap !== null && total !== null ? cap - total : null },
  ];
}

export const priceTypeLabel: Record<PriceEvidence["priceType"], string> = {
  published: "Published",
  estimated: "Estimate",
  verbal: "Verbal",
  written_quote: "Written quote",
  simulated: "Simulated",
  unknown: "Unknown",
};
