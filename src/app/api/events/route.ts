import { z } from "zod";
import { createEvent } from "@/lib/events";
import { redact } from "@/agents/harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().min(1), hostPhone: z.string().min(1) });

export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "text and hostPhone are required" }, { status: 400 });
  try {
    const e = await createEvent(p.data.text, p.data.hostPhone);
    return Response.json({ eventId: e.id, brief: e.brief, missing: e.missing }, { status: 201 });
  } catch (err) {
    console.error(redact(String(err)));
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
