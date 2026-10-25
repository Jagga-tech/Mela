// Frontend <-> backend contract for the Mela web app.
// Safe for client code: zod schemas + types only, no secrets, no server imports.
// Backend owners: validate responses against these at the boundary (see docs/frontend-integration.md).
// Mapping from the agent backend's src/lib/types.ts lives in src/mela/adapters/api.ts.
import { z } from "zod";

// ---------- provenance ----------

/** Where a payload came from. Every adapter response carries one so the UI never calls demo data live. */
export const DataOrigin = z.object({
  mode: z.enum(["live", "demo"]),
  provider: z.string(), // "bright_data" | "apify" | "cartesia" | "anthropic" | "fixture" | "rules" | ...
  label: z.string(), // human-readable, shown in the UI
});
export type DataOrigin = z.infer<typeof DataOrigin>;

// ---------- brief ----------

export const RequirementPriority = z.enum(["MUST_HAVE", "PREFERENCE", "FLEXIBLE", "UNSET"]);
export type RequirementPriority = z.infer<typeof RequirementPriority>;

export const RequirementKey = z.enum([
  "capacity",
  "venue_budget",
  "bathrooms",
  "climate_control",
  "outside_catering",
  "alcohol_allowed",
  "step_free_access",
  "indoor_outdoor",
  "style",
  "cuisine",
  "meat_options",
  "vegetarian_options",
  "custom",
]);
export type RequirementKey = z.infer<typeof RequirementKey>;

export const EventRequirement = z.object({
  id: z.string(),
  key: RequirementKey,
  label: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  priority: RequirementPriority,
  appliesTo: z.enum(["venue", "catering", "event"]),
  /** The host's own words this came from, when known. Never inferred. */
  saidAs: z.string().optional(),
});
export type EventRequirement = z.infer<typeof EventRequirement>;

export const BudgetScope = z.enum(["venue_only", "all_in", "food_and_venue", "unset"]);
export type BudgetScope = z.infer<typeof BudgetScope>;

export const EventBrief = z.object({
  id: z.string(),
  version: z.number().int().min(1),
  occasion: z.string(), // "" = not given
  city: z.string(),
  dateTarget: z.string().nullable(), // ISO date
  dateFlexibility: z.string().optional(),
  guestRange: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }).nullable(),
  budget: z.object({ amountCents: z.number().int().nonnegative().nullable(), scope: BudgetScope }),
  atmosphere: z.string().optional(),
  hostName: z.string().optional(),
  requirements: z.array(EventRequirement),
  /** Set only by an explicit host confirmation. Research refuses to start without it. */
  confirmedAt: z.string().nullable(),
});
export type EventBrief = z.infer<typeof EventBrief>;

export const ClarifyingQuestion = z.object({
  field: z.enum(["occasion", "city", "dateTarget", "guestRange", "budget.amountCents", "budget.scope", "requirements"]),
  question: z.string(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
});
export type ClarifyingQuestion = z.infer<typeof ClarifyingQuestion>;

export const IntakeResult = z.object({
  brief: EventBrief,
  questions: z.array(ClarifyingQuestion),
  changes: z.array(z.string()),
  origin: DataOrigin,
});
export type IntakeResult = z.infer<typeof IntakeResult>;

// ---------- research ----------

/** Same values as the research module's SourceStatus (data-sys branch, lib/research/contract.ts). */
export const ResearchStatus = z.enum(["queued", "searching", "fetching", "extracting", "slow", "found", "partial", "empty", "blocked", "error"]);
export type ResearchStatus = z.infer<typeof ResearchStatus>;

export const ResearchSource = z.object({
  id: z.string(),
  url: z.string(),
  label: z.string(),
  provider: z.enum(["bd_serp", "bd_unlocker", "apify", "fixture"]),
  sourceType: z.enum(["official_city", "venue_site", "vendor_site", "directory_listing", "public_posts"]),
  status: ResearchStatus,
  fetchedAt: z.string().optional(),
  latencyMs: z.number().optional(),
  attempt: z.number().int().min(0).max(2),
  error: z.string().optional(),
  vendorId: z.string().optional(),
});
export type ResearchSource = z.infer<typeof ResearchSource>;

export const ResearchJob = z.object({
  id: z.string(),
  briefId: z.string(),
  briefVersion: z.number().int(),
  status: z.enum(["running", "complete", "partial", "failed", "cancelled"]),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  sources: z.array(ResearchSource),
  origin: DataOrigin,
});
export type ResearchJob = z.infer<typeof ResearchJob>;

export const FactField = z.enum([
  "capacity",
  "rental_fee",
  "cleaning_fee",
  "price_per_guest",
  "bathrooms",
  "climate_control",
  "outside_catering",
  "alcohol",
  "step_free_access",
  "style",
  "indoor_outdoor",
  "cuisine",
  "meat_options",
  "vegetarian_options",
  "service_area",
  "contact_phone",
]);
export type FactField = z.infer<typeof FactField>;

export const SourceFact = z.object({
  id: z.string(),
  vendorId: z.string(),
  field: FactField,
  /** verified = the quote was found on the fetched page. unknown/conflicting are real states, never guesses. */
  state: z.enum(["verified", "unknown", "conflicting"]),
  value: z.union([z.number(), z.string(), z.boolean()]).optional(),
  quote: z.string().optional(), // verbatim from the page
  /** For numbers: "from about $32" is approximate, never a published price. */
  qualifier: z.enum(["exact", "approximate", "starting_at"]).optional(),
  sourceId: z.string().optional(),
  url: z.string().optional(),
  retrievedAt: z.string().optional(),
  unknownReason: z.enum(["not_on_page", "quote_mismatch", "source_failed", "sources_disagree"]).optional(),
});
export type SourceFact = z.infer<typeof SourceFact>;

export const ReviewEvidence = z.object({
  id: z.string(),
  vendorId: z.string(),
  kind: z.enum(["review", "photo", "post"]),
  provider: z.enum(["apify", "fixture"]),
  url: z.string(),
  retrievedAt: z.string(),
  postedAt: z.string().optional(),
  excerpt: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  imageUrl: z.string().optional(),
  attribution: z.string(),
  /** e.g. "1 of 37 public reviews, sampled Oct 24" — opinions, never verified policy. */
  sampleContext: z.string(),
});
export type ReviewEvidence = z.infer<typeof ReviewEvidence>;

export const VendorContact = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
  sourceFactId: z.string().optional(),
  sourceUrl: z.string().optional(),
  sourceLabel: z.string(),
});
export type VendorContact = z.infer<typeof VendorContact>;

export const VendorCategory = z.enum(["venue", "catering"]);
export type VendorCategory = z.infer<typeof VendorCategory>;

export const Vendor = z.object({
  id: z.string(),
  name: z.string(),
  category: VendorCategory,
  area: z.string(),
  website: z.string().optional(),
  contact: VendorContact.optional(),
  /** true for invented demo vendors; the UI must say so on every card. */
  fictional: z.boolean(),
  palette: z.tuple([z.string(), z.string()]).optional(), // card art when no permitted photo exists
});
export type Vendor = z.infer<typeof Vendor>;

export const PriceType = z.enum(["published", "estimated", "verbal", "written_quote", "simulated", "unknown"]);
export type PriceType = z.infer<typeof PriceType>;

export const PriceEvidence = z.object({
  priceType: PriceType,
  amountCents: z.number().int().nullable(), // total for the event when computable
  unit: z.enum(["flat", "per_guest", "unknown"]),
  unitCents: z.number().int().nullable(),
  note: z.string(),
  factIds: z.array(z.string()),
});
export type PriceEvidence = z.infer<typeof PriceEvidence>;

export const RequirementCheck = z.object({
  requirementId: z.string(),
  label: z.string(),
  priority: RequirementPriority,
  result: z.enum(["meets", "violates", "unknown", "conflicting", "not_applicable"]),
  factIds: z.array(z.string()),
  note: z.string(),
});
export type RequirementCheck = z.infer<typeof RequirementCheck>;

export const Recommendation = z.object({
  vendorId: z.string(),
  category: VendorCategory,
  /** verified_match: every must-have is met by a verified fact. possible: none violated, some unknown. excluded: a must-have is violated. */
  matchStatus: z.enum(["verified_match", "possible_match", "excluded"]),
  labels: z.array(z.enum(["best_fit", "lowest_published_estimate", "best_tradeoff"])),
  checks: z.array(RequirementCheck),
  reasons: z.array(z.string()),
  tradeoffs: z.array(z.string()),
  unknowns: z.array(z.string()),
  price: PriceEvidence,
});
export type Recommendation = z.infer<typeof Recommendation>;

export const ResearchSnapshot = z.object({
  job: ResearchJob,
  vendors: z.array(Vendor),
  facts: z.array(SourceFact),
  reviews: z.array(ReviewEvidence),
});
export type ResearchSnapshot = z.infer<typeof ResearchSnapshot>;

export const BudgetLine = z.object({
  category: VendorCategory,
  label: z.string(),
  capCents: z.number().int().nullable(),
  price: PriceEvidence,
  remainingCents: z.number().int().nullable(),
});
export type BudgetLine = z.infer<typeof BudgetLine>;

// ---------- calls ----------

export const SharedDetail = z.object({ key: z.string(), label: z.string(), value: z.string() });
export type SharedDetail = z.infer<typeof SharedDetail>;

export const CallPlan = z.object({
  id: z.string(),
  version: z.number().int().min(1),
  briefId: z.string(),
  vendorId: z.string(),
  vendorName: z.string(),
  phoneNumber: z.string(),
  numberSource: z.object({ label: z.string(), url: z.string().optional(), retrievedAt: z.string().optional() }),
  /** Demo calls only ever go to a consenting teammate playing a fictional venue. */
  rolePlay: z.boolean(),
  disclosure: z.string(),
  opening: z.string(),
  questions: z.array(z.string()),
  sharedDetails: z.array(SharedDetail),
  privateDetails: z.array(z.string()),
  mustNotAgreeTo: z.array(z.string()),
  createdAt: z.string(),
  scriptHash: z.string(),
});
export type CallPlan = z.infer<typeof CallPlan>;

export const CallApproval = z.object({
  id: z.string(),
  callPlanId: z.string(),
  callPlanVersion: z.number().int(),
  scriptHash: z.string(),
  vendorId: z.string(),
  phoneNumber: z.string(),
  disclosedKeys: z.array(z.string()),
  approvedBy: z.string(),
  approvedAt: z.string(),
  expiresAt: z.string(),
  maxAttempts: z.literal(1),
  attemptsUsed: z.number().int().min(0),
  status: z.enum(["active", "consumed", "revoked", "expired"]),
});
export type CallApproval = z.infer<typeof CallApproval>;

export const CallState = z.enum(["preparing", "approved", "dialing", "connected", "completed", "declined", "failed", "not_contacted"]);
export type CallState = z.infer<typeof CallState>;

export const CallAttempt = z.object({
  id: z.string(),
  approvalId: z.string(),
  callPlanId: z.string(),
  state: CallState,
  /** live = real telephony; role_play = real call to a consenting teammate; simulated = no call placed at all. */
  mode: z.enum(["live", "role_play", "simulated"]),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  providerCallId: z.string().optional(),
  transcript: z.array(z.object({ speaker: z.enum(["mela", "vendor"]), text: z.string() })),
  failureReason: z.string().optional(),
  origin: DataOrigin,
});
export type CallAttempt = z.infer<typeof CallAttempt>;

export const AvailabilityLabel = z.enum(["not_listed", "needs_confirmation", "vendor_said_verbally", "written_confirmation", "booked"]);
export type AvailabilityLabel = z.infer<typeof AvailabilityLabel>;

export const CallOutcome = z.object({
  attemptId: z.string(),
  answers: z.array(z.object({ question: z.string(), answer: z.string().nullable(), status: z.enum(["vendor_said_verbally", "not_answered"]) })),
  /** A call can never produce written_confirmation or booked. */
  availability: z.enum(["not_listed", "needs_confirmation", "vendor_said_verbally"]),
  price: PriceEvidence.nullable(),
  followUps: z.array(z.string()),
  recordedAt: z.string(),
});
export type CallOutcome = z.infer<typeof CallOutcome>;

// ---------- finance (amounts in integer cents) ----------

export const Actor = z.object({
  kind: z.enum(["agent", "human", "system"]),
  id: z.string(),
  name: z.string(),
  role: z.enum(["host", "ap_manager", "ap_agent", "system"]).optional(),
});
export type Actor = z.infer<typeof Actor>;

export const AuditEvent = z.object({
  id: z.string(),
  at: z.string(),
  actor: Actor,
  action: z.string(),
  detail: z.string().optional(),
  refs: z.array(z.string()),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const QuoteLine = z.object({ id: z.string(), label: z.string(), qty: z.number(), unitCents: z.number().int(), totalCents: z.number().int() });
export type QuoteLine = z.infer<typeof QuoteLine>;
export const Quote = z.object({
  id: z.string(), vendorId: z.string(), vendorName: z.string(), lines: z.array(QuoteLine), totalCents: z.number().int(),
  approvedBy: z.string().optional(), approvedAt: z.string().optional(),
});
export type Quote = z.infer<typeof Quote>;
export const InvoiceLine = z.object({ id: z.string(), label: z.string(), totalCents: z.number().int(), quoteLineId: z.string().optional() });
export type InvoiceLine = z.infer<typeof InvoiceLine>;
export const Invoice = z.object({
  id: z.string(), quoteId: z.string(), commitmentId: z.string().optional(), receivedAt: z.string().optional(),
  lines: z.array(InvoiceLine), totalCents: z.number().int(),
});
export type Invoice = z.infer<typeof Invoice>;
export const Policy = z.object({ id: z.string(), version: z.number().int(), rule: z.string(), maxAutoCents: z.number().int(), maxAutoPct: z.number() });
export type Policy = z.infer<typeof Policy>;

export const LineResult = z.object({
  invoiceLineId: z.string().nullable(),
  quoteLineId: z.string().nullable(),
  label: z.string(),
  quoteCents: z.number().int().nullable(),
  invoiceCents: z.number().int().nullable(),
  diffCents: z.number().int(),
  result: z.enum(["match", "not_in_quote", "amount_differs", "missing_on_invoice"]),
});
export type LineResult = z.infer<typeof LineResult>;

export const FinanceException = z.object({
  id: z.string(),
  invoiceId: z.string(),
  rule: z.literal("R-02"),
  failingLineIds: z.array(z.string()),
  deltaCents: z.number().int(),
  status: z.enum(["held", "auto_approved_with_notice", "resolved_rejected", "resolved_approved", "waiting_vendor"]),
  paymentDraftId: z.string(),
});
export type FinanceException = z.infer<typeof FinanceException>;

export const PaymentDraft = z.object({
  id: z.string(),
  amountCents: z.number().int(),
  /** There is no "paid" state: Mela never moves money. Release means a human may pay outside Mela. */
  status: z.enum(["held", "released_for_manual_payment", "revised_unreleased"]),
  requestedBy: z.string(),
  simulated: z.literal(true),
});
export type PaymentDraft = z.infer<typeof PaymentDraft>;

export const ManagerDecision = z.object({
  id: z.string(),
  exceptionId: z.string(),
  decision: z.enum(["approve_line", "reject_line", "ask_vendor"]),
  reason: z.string().min(3),
  actor: Actor,
  at: z.string(),
});
export type ManagerDecision = z.infer<typeof ManagerDecision>;

/**
 * Optional Stripe TEST-mode payment for a released draft. Separate from PaymentDraft on purpose:
 * the draft still never reaches a "paid" state, and no real money moves (test keys only).
 */
export const STRIPE_TEST_LABEL = "Stripe test mode · no real money moves";
export const StripeTestPayment = z.object({
  id: z.string(),
  paymentDraftId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.literal("usd"),
  provider: z.literal("stripe_test"),
  livemode: z.literal(false),
  /** pending = in flight; unknown = Stripe didn't answer clearly (safe to retry: same idempotency key). */
  status: z.enum(["pending", "succeeded", "failed", "unknown"]),
  stripePaymentIntentId: z.string().optional(),
  idempotencyKey: z.string(),
  attempts: z.number().int().min(1).max(2),
  requestedBy: Actor,
  requestedAt: z.string(),
  completedAt: z.string().optional(),
  failureReason: z.string().optional(),
  label: z.literal(STRIPE_TEST_LABEL),
});
export type StripeTestPayment = z.infer<typeof StripeTestPayment>;

export const FinanceCase = z.object({
  id: z.string(),
  eventLabel: z.string(),
  quote: Quote,
  commitmentId: z.string(),
  invoice: Invoice,
  policy: Policy,
  lineResults: z.array(LineResult),
  outcome: z.enum(["matched", "held", "auto_approved_with_notice"]),
  exception: FinanceException.nullable(),
  paymentDraft: PaymentDraft,
  decisions: z.array(ManagerDecision),
  audit: z.array(AuditEvent),
  origin: DataOrigin,
  /** Absent until a human sends a Stripe test payment for a released draft. */
  testPayment: StripeTestPayment.optional(),
});
export type FinanceCase = z.infer<typeof FinanceCase>;

export const VoiceStatus = z.object({ cartesia: z.boolean(), voiceId: z.string().nullable() });
export type VoiceStatus = z.infer<typeof VoiceStatus>;
