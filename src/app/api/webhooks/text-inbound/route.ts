import { z } from "zod";
import { onInboundText } from "@/lib/events";
import { redact } from "@/agents/harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ from: z.string().min(1), body: z.string(), rowId: z.number().int().optional() });

export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "from and body are required" }, { status: 400 });
  try {
    return Response.json({ outcome: await onInboundText(p.data.from, p.data.body, p.data.rowId) });
  } catch (err) {
    console.error(redact(String(err)));
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
