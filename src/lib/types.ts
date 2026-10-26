// Shared data contract. Frontend, backend and research all speak these shapes.
import type { Language } from "./i18n";

export type Priority = "must-have" | "preferred" | "flexible";

export type Preference = { label: string; priority: Priority };

export type EventBrief = {
  eventType: string; // e.g. "quinceañera"
  location: string; // e.g. "San Francisco, CA"
  dateWindow: { start: string; end: string } | null; // ISO dates
  guestCount: number | null;
  budgetUsd: number | null;
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

export type AuditEvent = { at: string; actor: string; action: string; detail?: string };

export type PurchaseOrder = { id: string; eventId: string; vendorId: string; quoteCallId: string; totalCents: number;
  depositCents: number | null; status: "open" | "invoiced" | "closed"; createdAt: string };
export type Invoice = { id: string; eventId: string; vendorId: string; poId: string | null; lineItems: LineItem[];
  totalCents: number; terms: string; paymentInstructions?: string; receivedAt: string };
export type FinanceExceptionKind = "mismatch" | "payment_change" | "duplicate" | "no_po";
export type FinanceException = { id: string; eventId: string; vendorId: string; invoiceId?: string; kind: FinanceExceptionKind;
  lines: string[]; explanation: string; approver: "host" | "planner"; status: "open" | "cleared"; createdAt: string };

export type VendorCategory = "venue" | "catering" | "decor";
export type Vendor = { id: string; name: string; category: VendorCategory; phone: string;
  capacity: number | null; priceHintUsd: number | null; accessibility: string[]; dietary: string[];
  contactFirstName: string; contactLastName: string; contactPhone: string; email: string | null; language: Language;
  address: { addressLine1: string; city: string; state: string; postalCode: string } | null };
export type RiskLevel = "clear" | "review" | "block";
export type VendorRisk = { vendorId: string; level: RiskLevel; reasons: string[]; checkedAt: string; source: "crs" };
export type MissingField = { field: keyof EventBrief; question: string };
export type CallScript = { opening: string; questions: string[]; closing: string; mustNotAgreeTo: string[] };
export type CallKind = "host_confirm" | "vendor" | "host_final";
export type CallRecord = { id: string; eventId: string; kind: CallKind; vendorId?: string; script: CallScript;
  status: "placed" | "ended" | "failed"; providerCallId?: string; transcript?: string; startedAt: string; endedAt?: string };
export type QuoteExtract = { available: boolean | null; priceUsd: number | null; depositUsd: number | null;
  terms: string[]; evidence: { field: string; line: string }[]; openQuestions: string[] };
export type VendorQuote = { vendorId: string; callId: string; extract: QuoteExtract; createdAt: string };
export type ShortlistItem = { vendorId: string; fit: FitStatus; conflicts: string[]; unknowns: string[]; reason: string; risk?: RiskLevel };
export type ApprovalKind = "plan" | "payment";
export type Approval = { id: string; eventId: string; kind: ApprovalKind; code: string; summary: string;
  status: "pending" | "approved" | "declined" | "expired"; createdAt: string; expiresAt: string;
  answeredAt?: string; answeredFrom?: string };
export type Mandate = { id: string; eventId: string; vendorIds: string[]; capCents: number; spentCents: number;
  expiresAt: string; status: "approved" | "paused" | "expired" };
export type Payment = { id: string; eventId: string; mandateId: string; vendorId: string; amountCents: number;
  idempotencyKey: string; status: "pending" | "succeeded" | "failed" | "unknown"; ref?: string;
  createdAt: string; kind: "deposit" | "balance" };
export type Message = { at: string; direction: "out" | "in"; to: string; body: string };
export type HumanTask = { id: string; eventId: string; to: "host" | "planner"; question: string; why: string;
  status: "open" | "answered" };
export type EventStatus = "draft" | "confirming" | "confirmed" | "calling" | "awaiting_approval" | "approved"
  | "paying" | "paid" | "done" | "needs_planner";
export type Event = { id: string; hostPhone: string; status: EventStatus; brief: EventBrief | null;
  missing: MissingField[]; shortlist: ShortlistItem[]; calls: CallRecord[]; quotes: VendorQuote[];
  approvals: Approval[]; mandate: Mandate | null; payments: Payment[]; messages: Message[];
  humanTasks: HumanTask[]; research: ResearchResult[]; audit: AuditEvent[];
  purchaseOrders: PurchaseOrder[]; invoices: Invoice[]; financeExceptions: FinanceException[]; language: Language; createdAt: string; updatedAt: string;
  hostName?: string; // from the web form, never from an agent; shared with booked vendors
  textsStopped?: boolean }; // host replied STOP
export const EVENT_STATUS_ORDER: EventStatus[] = ["draft","confirming","confirmed","calling","awaiting_approval","approved","paying","paid","done"];
