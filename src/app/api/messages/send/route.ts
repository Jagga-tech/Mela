// POST /api/messages/send  { to: "+14155551234", body: "..." }
// One door for every text Mela sends (host updates, vendor outreach). Runs on the demo Mac only.
import { NextResponse } from "next/server";
import { z } from "zod";
import { sendText } from "@/integrations/imessage";

const Body = z.object({
  to: z.string().regex(/^(\+?\d{10,15}|[^\s@]+@[^\s@]+)$/, "phone (E.164) or iMessage email"),
  body: z.string().min(1).max(1000),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, reason: parsed.error.issues[0].message }, { status: 400 });
  const result = await sendText(parsed.data.to, parsed.data.body);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
