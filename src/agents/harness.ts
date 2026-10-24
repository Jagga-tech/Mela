// Agent harness. Every agent is one Claude run with optional read-only tools (DB queries) and a fixed output schema.
// The orchestrator (plain code) decides what runs next; agents never call each other.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { z } from "zod";
import type { AuditEvent } from "@/lib/types";

const client = new Anthropic(); // server-side only; reads ANTHROPIC_API_KEY

export type AgentSpec<T> = {
  name: string;
  system: string;
  output: z.ZodType<T>;
  tools?: BetaRunnableTool<any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  maxToolRounds?: number; // caps the tool loop, e.g. 15 for the Lead
};

const log = (audit: AuditEvent[], actor: string, action: string, detail?: string) =>
  audit.push({ at: new Date().toISOString(), actor, action, detail });

// Returns null when the model can't produce valid output. Callers treat null as "unknown", never guess.
export async function runAgent<T>(spec: AgentSpec<T>, input: string, audit: AuditEvent[]): Promise<T | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const msg = await client.beta.messages.toolRunner({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        system: spec.system,
        tools: spec.tools ?? [],
        max_iterations: spec.maxToolRounds ?? 10,
        messages: [{ role: "user", content: input }],
        output_config: { format: betaZodOutputFormat(spec.output), effort: "low" },
      });
      const text = msg.content.find((b) => b.type === "text")?.text;
      const parsed = text ? spec.output.safeParse(JSON.parse(text)) : null;
      if (msg.stop_reason === "refusal" || !parsed?.success) {
        log(audit, spec.name, "agent_bad_output", `attempt ${attempt}: ${msg.stop_reason}`);
        continue;
      }
      log(audit, spec.name, "agent_ok");
      return parsed.data;
    } catch (err) {
      // ponytail: SDK already retries 429/5xx twice; this catches the rest (bad JSON, auth) so one agent can't crash the run
      log(audit, spec.name, "agent_error", String(err));
    }
  }
  return null;
}
