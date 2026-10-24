import { z } from "zod";
import { CARTESIA_VERSION, cartesiaKey, notConfigured, voiceId } from "../cartesia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().trim().min(1).max(600) });

export async function POST(req: Request) {
  const key = cartesiaKey();
  if (!key) return notConfigured();
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "text is required (max 600 chars)" }, { status: 400 });
  try {
    const res = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Cartesia-Version": CARTESIA_VERSION, "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: process.env.CARTESIA_TTS_MODEL || "sonic-3.6",
        transcript: p.data.text,
        voice: { id: voiceId() },
        output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
        language: "en",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error("[voice] cartesia tts", res.status, (await res.text()).slice(0, 200));
      return Response.json({ error: "Mela's voice is unavailable right now." }, { status: 502 });
    }
    return new Response(res.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Voice service timed out." }, { status: 504 });
  }
}
