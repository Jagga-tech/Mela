// Shared data contract. Frontend, backend and research all speak these shapes.

export type Priority = "must-have" | "preferred" | "flexible";

export type Preference = { label: string; priority: Priority };

export type EventBrief = {
  eventType: string; // e.g. "quinceañera"
  location: string; // e.g. "San Francisco, CA"
  dateWindow: { start: string; end: string }; // ISO dates
  guestCount: number;
  budgetUsd: number;
  feel?: string; // "warm, family-centered"
  accessibility: string[];
  dietary: string[]; // aggregate needs only, no guest-level data
  preferences: Preference[];
};

export type SourceStatus = "searching" | "found" | "slow" | "blocked" | "empty" | "partial";

export type ExtractedFact = {
  field: string; // "capacity", "permit_fee", "application_deadline_days"
  value: string | number | null; // null = unknown, never guessed
  evidence: string; // supporting snippet from the page
  unknownReason?: string;
};

export type ResearchResult = {
  sourceUrl: string;
  fetchedAt: string;
  status: SourceStatus;
  facts: ExtractedFact[];
  error?: string;
};

export type FitStatus = "fit" | "possible" | "conflict" | "unknown";

export type Recommendation = {
  name: string;
  fit: FitStatus;
  reasons: string[];
  conflicts: string[];
  knownCostsUsd: number[];
  unknowns: string[];
  sources: string[];
};

export type LineItem = { description: string; qty: number; unitPriceUsd: number };

export type Quote = { id: string; vendor: string; lineItems: LineItem[]; terms: string };

export type Invoice = {
  id: string;
  vendor: string;
  quoteId: string;
  lineItems: LineItem[];
  terms: string;
  paymentInstructions?: string;
};

export type ApprovalStatus = "pending" | "approved" | "held";

export type AuditEvent = { at: string; actor: string; action: string; detail?: string };

export type FinanceCase = {
  id: string;
  eventId: string;
  quote: Quote;
  invoice: Invoice;
  discrepancies: string[];
  approver: string;
  approval: ApprovalStatus;
  audit: AuditEvent[];
};

export type Event = {
  id: string;
  brief: EventBrief;
  confirmed: boolean;
  research: ResearchResult[];
  audit: AuditEvent[];
};
