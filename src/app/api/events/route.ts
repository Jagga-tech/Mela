import { z } from "zod";
import { createEvent } from "@/lib/events";
import { redact } from "@/agents/harness";
import { normalizePhone } from "@/integrations/phone";
import { LANGUAGES } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().min(1), hostPhone: z.string().min(1),
  hostName: z.string().trim().min(1).max(100).optional(), language: z.enum(LANGUAGES).optional() });

export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "text and hostPhone are required" }, { status: 400 });
  if (!normalizePhone(p.data.hostPhone)) return Response.json({ error: "hostPhone needs at least 10 digits" }, { status: 400 });
  try {
    const e = await createEvent(p.data.text, p.data.hostPhone, { hostName: p.data.hostName, language: p.data.language });
    return Response.json({ eventId: e.id, brief: e.brief, missing: e.missing }, { status: 201 });
  } catch (err) {
    console.error(redact(String(err)));
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
