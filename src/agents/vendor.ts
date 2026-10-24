import { z } from "zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { runAgent, type AgentResult, type AgentSpec } from "@/agents/harness";
import { makeDbTools } from "@/agents/dbTools";
import type { Store } from "@/lib/store";
import type { AuditEvent, EventBrief, ExtractedFact, VendorCategory } from "@/lib/types";

export type VendorOption = { vendorId: string; facts: ExtractedFact[] };
type Out = { options: VendorOption[] };

const OutputSchema: z.ZodType<Out> = z.object({
  options: z.array(
    z.object({
      vendorId: z.string(),
      facts: z.array(
        z.object({ field: z.string(), value: z.union([z.string(), z.number(), z.null()]), evidence: z.string(), unknownReason: z.string().optional() }),
      ),
    }),
  ),
});

export const vendorSpec = (tools: BetaRunnableTool<any>[]): AgentSpec<Out> => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  name: "vendor",
  output: OutputSchema,
  tools,
  maxToolRounds: 4,
  effort: "low",
  system: `You find vendors for an event brief using the search_vendors and get_vendor tools.
- Use only tool results. Never add a vendor the tools did not return, and never guess a value.
- Return one option per relevant vendor, with facts such as capacity, priceHintUsd, accessibility, dietary.
- Every fact's "evidence" is the field name and value exactly as the tool returned it (e.g. "capacity: 150").
- If a field is null or missing, give value null and an unknownReason.`,
});

export function findVendors(store: Store, brief: EventBrief, category: VendorCategory, audit: AuditEvent[]): Promise<AgentResult<Out>> {
  return runAgent(vendorSpec(makeDbTools(store)), "Category: " + category + "\nBrief:\n" + JSON.stringify(brief), audit);
}
