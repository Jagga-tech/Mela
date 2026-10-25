import "server-only";
import type { CallApproval, CallAttempt, CallOutcome, CallPlan } from "@/mela/contracts";

// Plans, approvals and attempts live in this server process's memory, on globalThis so
// `next dev` hot reloads keep them. The client only ever sends ids; the server looks up
// its own copy, so a client-edited approval or plan is never trusted.

export interface AttemptRecord {
  attempt: CallAttempt;
  plan: CallPlan;
  outcome: CallOutcome | null;
  lastPolledAt: number;
  polling?: Promise<void>;
}

interface CallStore {
  plans: Map<string, CallPlan>;
  approvals: Map<string, CallApproval>;
  attempts: Map<string, AttemptRecord>;
  byProviderId: Map<string, string>;
  seenWebhooks: Set<string>;
}

const MAX_ENTRIES = 200;

const g = globalThis as typeof globalThis & { __melaCalls?: CallStore };
export const callStore: CallStore = (g.__melaCalls ??= {
  plans: new Map(),
  approvals: new Map(),
  attempts: new Map(),
  byProviderId: new Map(),
  seenWebhooks: new Set(),
});

function cap<K, V>(m: Map<K, V> | Set<K>) {
  while (m.size > MAX_ENTRIES) m.delete(m.keys().next().value!);
}

export function savePlan(p: CallPlan) {
  callStore.plans.set(p.id, p);
  cap(callStore.plans);
}

export function saveApproval(a: CallApproval) {
  callStore.approvals.set(a.id, a);
  cap(callStore.approvals);
}

export function saveAttempt(r: AttemptRecord) {
  callStore.attempts.set(r.attempt.id, r);
  if (r.attempt.providerCallId) callStore.byProviderId.set(r.attempt.providerCallId, r.attempt.id);
  cap(callStore.attempts);
  cap(callStore.byProviderId);
}

/** True the first time a webhook delivery id is seen (Cartesia retries up to 3 times). */
export function firstDelivery(id: string | undefined): boolean {
  if (!id) return true;
  if (callStore.seenWebhooks.has(id)) return false;
  callStore.seenWebhooks.add(id);
  while (callStore.seenWebhooks.size > MAX_ENTRIES * 10) callStore.seenWebhooks.delete(callStore.seenWebhooks.values().next().value!);
  return true;
}

/** Tests only. */
export function resetCallStore() {
  callStore.plans.clear();
  callStore.approvals.clear();
  callStore.attempts.clear();
  callStore.byProviderId.clear();
  callStore.seenWebhooks.clear();
}
