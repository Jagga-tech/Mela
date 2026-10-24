// Live intake for the web app: runs the team's intake agent (src/agents/intake.ts) and maps its
// brief into the web contract. Unlike POST /api/events it creates no event and triggers no calls.
import { z } from "zod";
import { runIntake } from "@/agents/intake";
import { redact } from "@/agents/harness";
import type { AuditEvent } from "@/lib/types";
import { ClarifyingQuestion, EventBrief, type IntakeResult } from "@/mela/contracts";
import { fromAgentBrief, toAgentBrief } from "@/mela/adapters/agentBrief";
import { applyParsed, parseIntakeText, questionsFor } from "@/mela/domain/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().trim().min(1).max(4000), brief: EventBrief.nullable(), answering: ClarifyingQuestion.nullish() });

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "Live intake isn't configured (ANTHROPIC_API_KEY missing)." }, { status: 503 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "text is required" }, { status: 400 });
  const { text, brief } = p.data;
  try {
    const audit: AuditEvent[] = [];
    const r = await runIntake(text, brief ? toAgentBrief(brief) : null, audit);
    if (!r.ok) return Response.json({ error: `Intake agent couldn't read that (${r.reason}).` }, { status: 502 });
    const mapped = fromAgentBrief(r.data.brief, brief);
    // The agent schema has no guest range or budget scope; take those from the host's literal words.
    const literal = parseIntakeText(text);
    const extra = applyParsed(mapped.brief, {
      requirements: [],
      budgetScope: literal.budgetScope,
      guestRange: literal.guestRange && literal.guestRange.min !== literal.guestRange.max ? literal.guestRange : undefined,
    });
    const out: IntakeResult = {
      brief: extra.brief,
      questions: questionsFor(extra.brief),
      changes: [...mapped.changes, ...extra.changes],
      origin: { mode: "live", provider: "anthropic", label: "Read by Mela's intake agent (Claude)" },
    };
    return Response.json(out);
  } catch (err) {
    console.error(redact(String(err)));
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
