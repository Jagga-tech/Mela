import { z } from "zod";
import { fence, runAgent, type AgentSpec } from "@/agents/harness";
import type { AuditEvent, Invoice, PurchaseOrder } from "@/lib/types";

type Out = { explanation: string };

export const financeSpec: AgentSpec<Out> = {
  name: "finance",
  output: z.object({ explanation: z.string().max(300) }),
  effort: "low",
  system: `You explain why a vendor invoice was held, to an event host.
- One plain sentence, under 40 words. Cite the numbers exactly as given; do no new arithmetic.
- Use only the discrepancy lines and the PO/invoice data given.
- Never say what to do about the money (no "pay", "don't pay", "approve").`,
};

export async function explainDiscrepancies(po: PurchaseOrder, inv: Invoice, lines: string[], audit: AuditEvent[]): Promise<string> {
  // the invoice is vendor-supplied, so it is fenced; payment instructions never reach the model (payment_change skips it entirely)
  const { paymentInstructions: _omit, ...invoice } = inv; // eslint-disable-line @typescript-eslint/no-unused-vars
  const input = `PO (ours): ${JSON.stringify(po)}\nDiscrepancies (ours): ${JSON.stringify(lines)}\n\n${fence("invoice", JSON.stringify(invoice))}`;
  const r = await runAgent(financeSpec, input, audit);
  return r.ok ? r.data.explanation : lines.join(" ");
}
