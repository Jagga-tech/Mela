import { z } from "zod";
import { answerEvent } from "@/lib/events";
import { store } from "@/lib/store";
import { redact } from "@/agents/harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().min(1) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "text is required" }, { status: 400 });
  try {
    const { id } = await params;
    if (!(await store.getEvent(id))) return Response.json({ error: "not found" }, { status: 404 });
    const e = await answerEvent(id, p.data.text);
    return Response.json({ brief: e.brief, missing: e.missing, status: e.status });
  } catch (err) {
    console.error(redact(String(err)));
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
