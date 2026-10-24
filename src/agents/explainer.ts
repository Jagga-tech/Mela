import { z } from "zod";
import { runAgent, type AgentResult, type AgentSpec } from "@/agents/harness";
import type { AuditEvent, FitStatus } from "@/lib/types";

type Out = { reasons: { vendorId: string; reason: string }[] };
type Item = { vendorId: string; name: string; fit: FitStatus; conflicts: string[]; unknowns: string[] };

const OutputSchema: z.ZodType<Out> = z.object({ reasons: z.array(z.object({ vendorId: z.string(), reason: z.string() })) });

export const explainerSpec: AgentSpec<Out> = {
  name: "explainer",
  output: OutputSchema,
  effort: "low",
  system: `You write one plain sentence per vendor explaining its fit to a host.
- Under 20 words. State the fit exactly as given; never change it.
- Do no arithmetic. Mention conflicts or unknowns only as given.
- Return one reason per input vendorId.`,
};

export function explain(items: Item[], audit: AuditEvent[]): Promise<AgentResult<Out>> {
  return runAgent(explainerSpec, JSON.stringify(items), audit);
}
