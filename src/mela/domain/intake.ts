// Rule-based intake used by the demo adapter (and as a fallback when the LLM intake is down).
// It only records what the host literally said. Anything it can't read becomes a question,
// never a guess. Priorities come only from the host's own wording ("must", "prefer", "flexible").
import type { BudgetScope, ClarifyingQuestion, EventBrief, EventRequirement, RequirementKey, RequirementPriority } from "../contracts";
import { newId, usd } from "./util";

const OCCASIONS = [
  "baby shower", "bridal shower", "quinceañera", "quinceanera", "wedding", "birthday", "graduation",
  "anniversary", "retirement", "reunion", "engagement party", "baptism", "bar mitzvah", "bat mitzvah",
];
const CITIES = ["Oakland", "San Francisco", "Berkeley", "San Jose", "Alameda", "Emeryville", "Fremont", "Hayward", "Richmond", "Palo Alto", "Los Angeles", "San Diego", "Sacramento"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const CUISINES = ["Mexican", "Italian", "Indian", "Chinese", "Thai", "Filipino", "Korean", "Japanese", "Mediterranean", "Ethiopian", "Vietnamese", "Salvadoran", "Peruvian", "BBQ", "Soul food"];

type Rule = { key: RequirementKey; re: RegExp; label: string; appliesTo: EventRequirement["appliesTo"]; value?: string | boolean };
const RULES: Rule[] = [
  { key: "bathrooms", re: /\b(bath ?rooms?|restrooms?|toilets?)\b/i, label: "Bathrooms on site", appliesTo: "venue", value: true },
  { key: "climate_control", re: /\b(climate[- ]control(led)?|a\/?c\b|air[- ]condition\w*|heating)\b/i, label: "Climate control", appliesTo: "venue", value: true },
  { key: "outside_catering", re: /\b(outside cater\w*|bring (our|my) own (food|cater\w*)|external cater\w*)\b/i, label: "Allows outside catering", appliesTo: "venue", value: true },
  { key: "alcohol_allowed", re: /\b(alcohol|drinks|bar service|beer|wine)\b/i, label: "Alcohol allowed", appliesTo: "venue", value: true },
  { key: "step_free_access", re: /\b(step[- ]free|wheelchair|accessible entrance|no stairs)\b/i, label: "Step-free access", appliesTo: "venue", value: true },
  { key: "indoor_outdoor", re: /\b(indoor(s)? or outdoor(s)?|indoor\/outdoor|inside or outside)\b/i, label: "Indoor or outdoor", appliesTo: "venue", value: "either" },
  { key: "style", re: /\bmodern\w*(-feeling)?\b/i, label: "Modern feel", appliesTo: "venue", value: "modern" },
  { key: "meat_options", re: /\bmeat\b/i, label: "Meat options", appliesTo: "catering", value: true },
  { key: "vegetarian_options", re: /\bvegetarian\b/i, label: "Vegetarian options", appliesTo: "catering", value: true },
];

const MUST = /\b(must|need(s|ed)?|required?|has to|have to|non-negotiable|essential)\b/i;
const PREFER = /\b(prefer(ably|red)?|ideally|would love|i'd love|nice to have|hoping for|like)\b/i;
const FLEX = /\b(flexible|either( is| way)?|don'?t mind|doesn'?t matter|fine|open to)\b/i;

function signal(text: string): RequirementPriority {
  // flexible first: "either is fine" also contains "fine"; "must" wins over "prefer" inside one clause
  if (MUST.test(text)) return "MUST_HAVE";
  if (FLEX.test(text)) return "FLEXIBLE";
  if (PREFER.test(text)) return "PREFERENCE";
  return "UNSET";
}

function clauses(text: string): { clause: string; sentencePriority: RequirementPriority }[] {
  const out: { clause: string; sentencePriority: RequirementPriority }[] = [];
  for (const sentence of text.split(/(?<=[.!?;])\s+|\n+/)) {
    const parts = sentence.split(/,\s*(?:and|but)\s+|\s+but\s+|,\s*while\s+/i).filter((p) => p.trim());
    const kinds = new Set(parts.map(signal).filter((p) => p !== "UNSET"));
    const sentencePriority = kinds.size === 1 ? [...kinds][0] : "UNSET";
    for (const clause of parts) out.push({ clause, sentencePriority });
  }
  return out;
}

export type ParsedIntake = Partial<Pick<EventBrief, "occasion" | "city" | "dateTarget" | "guestRange" | "hostName">> & {
  budgetCents?: number;
  budgetScope?: BudgetScope;
  requirements: EventRequirement[];
};

export function parseIntakeText(text: string): ParsedIntake {
  const lower = text.toLowerCase();
  const out: ParsedIntake = { requirements: [] };

  const occ = OCCASIONS.find((o) => lower.includes(o));
  if (occ) out.occasion = occ === "quinceanera" ? "quinceañera" : occ;

  const city = CITIES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(text));
  if (city) out.city = city;

  const range = text.match(/(\d{2,4})\s*(?:-|–|to)\s*(\d{2,4})\s*(?:guests|people|persons|folks)/i);
  const single = text.match(/(?:about|around|roughly|~)?\s*(\d{2,4})\s*(?:guests|people|persons|folks)/i);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y);
    out.guestRange = { min: a, max: b };
  } else if (single) {
    out.guestRange = { min: Number(single[1]), max: Number(single[1]) };
  }

  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const named = text.match(new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d{2}))?`, "i"));
  if (iso) out.dateTarget = iso[0];
  else if (named && named[3]) {
    const m = MONTHS.indexOf(named[1].toLowerCase()) + 1;
    out.dateTarget = `${named[3]}-${String(m).padStart(2, "0")}-${String(Number(named[2])).padStart(2, "0")}`;
  }

  const money = text.match(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?\s*(k\b)?/i);
  if (money) {
    let dollars = Number(money[1].replace(/,/g, ""));
    if (money[3]) dollars *= 1000;
    out.budgetCents = dollars * 100 + (money[2] ? Number(money[2]) : 0);
  }
  if (/\b(venue budget|budget for the venue|for the venue( only)?|venue only|venue cap)\b/i.test(text)) out.budgetScope = "venue_only";
  else if (/\b(food and venue|venue and food|venue and catering|catering and venue)\b/i.test(text)) out.budgetScope = "food_and_venue";
  else if (/\b(total|all[- ]in|whole event|entire event|everything)\b/i.test(text)) out.budgetScope = "all_in";

  const name = text.match(/\b(?:my name is|i'm|i am)\s+([A-Z][a-z]+)\b(?!\s+(?:planning|hosting|looking|throwing))/);
  if (name && !OCCASIONS.includes(name[1].toLowerCase())) out.hostName = name[1];

  const seen = new Set<RequirementKey>();
  for (const { clause, sentencePriority } of clauses(text)) {
    const own = signal(clause);
    const priority = own !== "UNSET" ? own : sentencePriority;
    for (const r of RULES) {
      if (seen.has(r.key) || !r.re.test(clause)) continue;
      seen.add(r.key);
      // "indoor or outdoor" is flexible by its own meaning
      const p = r.key === "indoor_outdoor" && priority === "UNSET" ? "FLEXIBLE" : priority;
      out.requirements.push({ id: r.key, key: r.key, label: r.label, value: r.value ?? true, priority: p, appliesTo: r.appliesTo, saidAs: clause.trim() });
    }
    const cuisine = CUISINES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(clause));
    if (cuisine && !seen.has("cuisine")) {
      seen.add("cuisine");
      out.requirements.push({ id: "cuisine", key: "cuisine", label: `${cuisine} food`, value: cuisine, priority, appliesTo: "catering", saidAs: clause.trim() });
    }
    if (out.budgetCents !== undefined && /\$/.test(clause) && !seen.has("venue_budget") && out.budgetScope === "venue_only") {
      seen.add("venue_budget");
      out.requirements.push({ id: "venue_budget", key: "venue_budget", label: `Venue at or under ${usd(out.budgetCents)}`, value: out.budgetCents, priority, appliesTo: "venue", saidAs: clause.trim() });
    }
  }
  return out;
}

/** Map a free-text requirement label (e.g. from the LLM intake's preferences[]) onto a known key, else "custom". */
export function requirementFromLabel(label: string, priority: RequirementPriority): EventRequirement {
  const rule = RULES.find((r) => r.re.test(label));
  if (rule) return { id: rule.key, key: rule.key, label: rule.label, value: rule.value ?? true, priority, appliesTo: rule.appliesTo, saidAs: label };
  const cuisine = CUISINES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(label));
  if (cuisine) return { id: "cuisine", key: "cuisine", label: `${cuisine} food`, value: cuisine, priority, appliesTo: "catering", saidAs: label };
  const id = "custom_" + label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
  return { id, key: "custom", label: label.charAt(0).toUpperCase() + label.slice(1), value: true, priority, appliesTo: "event", saidAs: label };
}

export function emptyBrief(): EventBrief {
  return { id: newId("brief"), version: 1, occasion: "", city: "", dateTarget: null, guestRange: null,
    budget: { amountCents: null, scope: "unset" }, requirements: [], confirmedAt: null };
}

/** Capacity and the venue cap follow from what the host already told us, so they're kept in sync rather than re-asked. */
function syncDerived(b: EventBrief): EventBrief {
  const reqs = [...b.requirements];
  const cap = reqs.find((r) => r.key === "capacity");
  if (b.guestRange) {
    const label = `Fits ${b.guestRange.max} guests`;
    if (cap) Object.assign(cap, { value: b.guestRange.max, label });
    else reqs.unshift({ id: "capacity", key: "capacity", label, value: b.guestRange.max, priority: "UNSET", appliesTo: "venue" });
  }
  const vb = reqs.find((r) => r.key === "venue_budget");
  if (b.budget.scope === "venue_only" && b.budget.amountCents !== null) {
    const label = `Venue at or under ${usd(b.budget.amountCents)}`;
    if (vb) Object.assign(vb, { value: b.budget.amountCents, label });
    else reqs.push({ id: "venue_budget", key: "venue_budget", label, value: b.budget.amountCents, priority: "UNSET", appliesTo: "venue" });
  } else if (vb) reqs.splice(reqs.indexOf(vb), 1);
  return { ...b, requirements: reqs };
}

/** Apply parsed host words to a brief. Returns human-readable changes. Fields the host didn't mention are kept. */
export function applyParsed(brief: EventBrief, p: ParsedIntake): { brief: EventBrief; changes: string[] } {
  const changes: string[] = [];
  const next: EventBrief = structuredClone(brief);
  const set = <K extends keyof EventBrief>(k: K, v: EventBrief[K], label: string) => {
    if (JSON.stringify(next[k]) !== JSON.stringify(v)) { next[k] = v; changes.push(label); }
  };
  if (p.occasion) set("occasion", p.occasion, `Occasion: ${p.occasion}`);
  if (p.city) set("city", p.city, `City: ${p.city}`);
  if (p.dateTarget) set("dateTarget", p.dateTarget, `Date: ${p.dateTarget}`);
  if (p.guestRange) set("guestRange", p.guestRange, `Guests: ${p.guestRange.min === p.guestRange.max ? p.guestRange.max : `${p.guestRange.min}–${p.guestRange.max}`}`);
  if (p.hostName) set("hostName", p.hostName, `Name: ${p.hostName}`);
  if (p.budgetCents !== undefined || p.budgetScope) {
    const budget = { amountCents: p.budgetCents ?? next.budget.amountCents, scope: p.budgetScope ?? next.budget.scope };
    set("budget", budget, `Budget: ${usd(budget.amountCents)} (${budget.scope.replace("_", " ")})`);
  }
  for (const r of p.requirements) {
    const i = next.requirements.findIndex((x) => x.key === r.key && r.key !== "custom");
    if (i === -1) { next.requirements.push(r); changes.push(`Added: ${r.label}`); }
    else if (r.priority !== "UNSET" && next.requirements[i].priority !== r.priority) {
      next.requirements[i] = { ...next.requirements[i], priority: r.priority };
      changes.push(`${r.label}: ${r.priority.toLowerCase().replace("_", " ")}`);
    }
  }
  const synced = syncDerived(next);
  if (changes.length) { synced.version = brief.version + 1; synced.confirmedAt = null; }
  return { brief: synced, changes };
}

/** One host edit from the brief editor. Any edit un-confirms the brief. */
export function editBrief(brief: EventBrief, patch: Partial<Omit<EventBrief, "id" | "version" | "confirmedAt">>): EventBrief {
  return syncDerived({ ...brief, ...patch, version: brief.version + 1, confirmedAt: null });
}

export function setRequirementPriority(brief: EventBrief, requirementId: string, priority: RequirementPriority): EventBrief {
  return editBrief(brief, { requirements: brief.requirements.map((r) => (r.id === requirementId ? { ...r, priority } : r)) });
}

export function removeRequirement(brief: EventBrief, requirementId: string): EventBrief {
  return editBrief(brief, { requirements: brief.requirements.filter((r) => r.id !== requirementId) });
}

export function questionsFor(b: EventBrief): ClarifyingQuestion[] {
  const q: ClarifyingQuestion[] = [];
  if (!b.occasion) q.push({ field: "occasion", question: "What are we celebrating?" });
  if (!b.city) q.push({ field: "city", question: "Which city should I search in?" });
  if (!b.dateTarget) q.push({ field: "dateTarget", question: "What date are you hoping for? Please include the year." });
  if (!b.guestRange) q.push({ field: "guestRange", question: "About how many guests are you expecting? A range is fine." });
  if (b.budget.amountCents === null) q.push({ field: "budget.amountCents", question: "Do you have a budget in mind? A number helps me filter honestly." });
  else if (b.budget.scope === "unset")
    q.push({
      field: "budget.scope",
      question: `Is ${usd(b.budget.amountCents)} for the venue only, or for the whole event?`,
      options: [
        { label: "Venue only", value: "venue_only" },
        { label: "Whole event", value: "all_in" },
        { label: "Food + venue", value: "food_and_venue" },
      ],
    });
  return q;
}

/** What still blocks confirmation. Research cannot start until this is empty and the host confirms. */
export function confirmationBlockers(b: EventBrief): string[] {
  const out = questionsFor(b).map((q) => q.question);
  const unset = b.requirements.filter((r) => r.priority === "UNSET");
  if (unset.length) out.push(`Mark ${unset.map((r) => r.label.toLowerCase()).join(", ")} as must-have, preference or flexible.`);
  return out;
}

export function confirmBrief(b: EventBrief, now = new Date()): EventBrief {
  const blockers = confirmationBlockers(b);
  if (blockers.length) throw new Error("Brief is not ready: " + blockers[0]);
  return { ...b, confirmedAt: now.toISOString() };
}

export function answerQuestion(brief: EventBrief, q: ClarifyingQuestion | null, text: string): { brief: EventBrief; changes: string[] } {
  const parsed = parseIntakeText(text);
  if (q?.field === "budget.scope") {
    const opt = q.options?.find((o) => o.value === text || o.label.toLowerCase() === text.toLowerCase());
    if (opt) parsed.budgetScope = opt.value as BudgetScope;
    else if (/venue/i.test(text) && !/food|cater|whole|all/i.test(text)) parsed.budgetScope = "venue_only";
  }
  if (q?.field === "occasion" && !parsed.occasion && text.trim().length < 60) parsed.occasion = text.trim().toLowerCase();
  if (q?.field === "city" && !parsed.city && text.trim().length < 40) parsed.city = text.trim().replace(/\b\w/g, (c) => c.toUpperCase());
  if (q?.field === "guestRange" && !parsed.guestRange) {
    const nums = text.match(/\d{1,4}/g)?.map(Number);
    if (nums?.length) parsed.guestRange = { min: Math.min(...nums.slice(0, 2)), max: Math.max(...nums.slice(0, 2)) };
  }
  if (q?.field === "budget.amountCents" && parsed.budgetCents === undefined) {
    const n = text.match(/\d[\d,]*/);
    if (n) parsed.budgetCents = Number(n[0].replace(/,/g, "")) * 100;
  }
  return applyParsed(brief, parsed);
}

export const priorityLabel: Record<RequirementPriority, string> = {
  MUST_HAVE: "Must-have",
  PREFERENCE: "Preference",
  FLEXIBLE: "Flexible",
  UNSET: "Not set",
};

export const scopeLabel: Record<BudgetScope, string> = {
  venue_only: "Venue only",
  all_in: "Whole event",
  food_and_venue: "Food + venue",
  unset: "Not set — ask",
};
