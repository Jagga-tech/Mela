import type { FinanceCase } from "@/mela/contracts";

// Finance cases live in this server process's memory, like research jobs (src/lib/research/jobStore.ts):
// the demo runs on one long-lived `next start`. Kept on globalThis so `next dev` hot reloads keep them.

const MAX_CASES = 50;

const g = globalThis as typeof globalThis & { __melaFinanceCases?: Map<string, FinanceCase> };
const cases = (g.__melaFinanceCases ??= new Map<string, FinanceCase>());

export function saveCase(fc: FinanceCase): void {
  cases.delete(fc.id); // re-insert so the most recently changed case is dropped last
  cases.set(fc.id, fc);
  while (cases.size > MAX_CASES) cases.delete(cases.keys().next().value!);
}

export function getCase(id: string): FinanceCase | undefined {
  return cases.get(id);
}

/** Tests only. */
export function clearCases(): void {
  cases.clear();
}
