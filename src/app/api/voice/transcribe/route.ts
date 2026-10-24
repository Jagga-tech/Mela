import { CARTESIA_VERSION, cartesiaKey, notConfigured } from "../cartesia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request) {
  const key = cartesiaKey();
  if (!key) return notConfigured();
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) return Response.json({ error: "No audio received." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Recording is too long." }, { status: 413 });

  const out = new FormData();
  out.append("file", file, "speech.webm");
  out.append("model", "ink-whisper");
  out.append("language", "en");
  try {
    const res = await fetch("https://api.cartesia.ai/stt", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Cartesia-Version": CARTESIA_VERSION },
      body: out,
      signal: AbortSignal.timeout(30_000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || typeof json?.text !== "string") {
      console.error("[voice] cartesia stt", res.status, JSON.stringify(json)?.slice(0, 200));
      return Response.json({ error: "Couldn't transcribe that. Try again or type instead." }, { status: 502 });
    }
    return Response.json({ text: json.text.trim() });
  } catch {
    return Response.json({ error: "Voice service timed out. Try again or type instead." }, { status: 504 });
  }
}
