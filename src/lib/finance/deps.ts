import { stripeTestCharge, type TestCharge } from "@/integrations/pay";
import { findLiveResearch, type LiveResearch } from "./research";
import { vendorCheckNotConnected, type VendorRiskGate } from "./vendorRisk";

// What the finance routes depend on, swappable in tests (and where the CRS vendor check plugs in).
// Env vars are not read here: the routes read STRIPE_SECRET_KEY and pass it in.

export interface FinanceDeps {
  findResearch(briefId: string, jobId?: string): Promise<LiveResearch | undefined>;
  /** Builds the Stripe test-mode charge for a key. Throws StripeKeyRefused for anything but a test key. */
  stripeCharge(secretKey: string): TestCharge;
  vendorRiskGate: VendorRiskGate;
  now(): Date;
}

const defaults: FinanceDeps = {
  findResearch: findLiveResearch,
  stripeCharge: (key) => stripeTestCharge(key),
  vendorRiskGate: vendorCheckNotConnected,
  now: () => new Date(),
};

let current: FinanceDeps = { ...defaults };

export const financeDeps = (): FinanceDeps => current;

export function configureFinance(overrides: Partial<FinanceDeps>): void {
  current = { ...current, ...overrides };
}

export function resetFinanceDeps(): void {
  current = { ...defaults };
}
