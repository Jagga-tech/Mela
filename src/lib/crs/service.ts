// One vendor risk check: business lookup → business credit (needs the BIN), with the
// OFAC screen in parallel. The level comes from ./rules.ts. No env reads here.

import type { VendorRisk } from "@/mela/contracts";
import { runBusinessCredit, runBusinessSearch, runOfac, type BusinessIdentity, type CheckOutcome, type CreditData, type OfacConfig } from "./checks";
import type { CrsClient } from "./client";
import { decideRisk } from "./rules";
import { saveRisk } from "./store";

export interface CheckDeps {
  client: CrsClient;
  ofac: OfacConfig | null;
  now?: () => Date;
}

const g = globalThis as typeof globalThis & { __melaVendorRiskInFlight?: Map<string, Promise<VendorRisk>> };
const inFlight = (g.__melaVendorRiskInFlight ??= new Map());

/** Runs the checks, saves the result, and returns it. Concurrent calls for one vendor share a run. */
export function checkVendorRisk(vendorId: string, business: BusinessIdentity, deps: CheckDeps): Promise<VendorRisk> {
  const running = inFlight.get(vendorId);
  if (running) return running;
  const run = runChecks(vendorId, business, deps).finally(() => inFlight.delete(vendorId));
  inFlight.set(vendorId, run);
  return run;
}

async function runChecks(vendorId: string, business: BusinessIdentity, deps: CheckDeps): Promise<VendorRisk> {
  const [search, ofac] = await Promise.all([runBusinessSearch(deps.client, business), runOfac(deps.client, business, deps.ofac)]);

  let credit: CheckOutcome<CreditData>;
  if (search.status === "ok") credit = await runBusinessCredit(deps.client, search.data.hit.bin);
  else if (search.status === "no_match") credit = { status: "skipped", detail: "No business matched, so there is no credit file to read." };
  else credit = { status: "skipped", detail: "Skipped because the business lookup didn't finish." };

  const risk = decideRisk({ vendorId, searchedName: business.name, search, credit, ofac, now: (deps.now ?? (() => new Date()))() });
  saveRisk(risk);
  return risk;
}
