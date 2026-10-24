import { z } from "zod";
import { runAgent, type AgentSpec } from "@/agents/harness";
import type { AuditEvent, Invoice, PurchaseOrder } from "@/lib/types";

type Out = { explanation: string };

export const financeSpec: AgentSpec<Out> = {
  name: "finance",
  output: z.object({ explanation: z.string() }),
  effort: "low",
  system: `You explain why a vendor invoice was held, to an event host.
- One plain sentence, under 40 words. Cite the numbers exactly as given; do no new arithmetic.
- Use only the discrepancy lines and the PO/invoice data given.
- Never say what to do about the money (no "pay", "don't pay", "approve").`,
};

export async function explainDiscrepancies(po: PurchaseOrder, inv: Invoice, lines: string[], audit: AuditEvent[]): Promise<string> {
  const r = await runAgent(financeSpec, JSON.stringify({ po, invoice: inv, discrepancies: lines }), audit);
  return r.ok ? r.data.explanation : lines.join(" ");
}
