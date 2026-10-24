import { z } from "zod";
import { onCallEnded } from "@/lib/events";
import { redact } from "@/agents/harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ callId: z.string().min(1), transcript: z.string() });

export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "callId and transcript are required" }, { status: 400 });
  try {
    await onCallEnded(p.data.callId, p.data.transcript);
    return Response.json({ ok: true });
  } catch (err) {
    console.error(redact(String(err)));
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
