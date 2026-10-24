// Voice goes through this app's own server routes, which hold the Cartesia key.
// The browser never sees a Cartesia credential.
import { VoiceStatus } from "../contracts";
import { ServiceError } from "../service";
import { requestJson } from "./http";
import { z } from "zod";

export const voiceClient = {
  async voiceStatus() {
    try {
      return await requestJson("/api/voice/status", VoiceStatus, { timeoutMs: 5000 });
    } catch {
      return { cartesia: false, voiceId: null };
    }
  },
  async transcribe(audio: Blob) {
    const form = new FormData();
    form.append("file", audio, "speech.webm");
    const res = await fetch("/api/voice/transcribe", { method: "POST", body: form, signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (!res) throw new ServiceError("Couldn't reach the voice service.", "network");
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ServiceError(json?.error ?? "Transcription failed.", res.status === 503 ? "not_connected" : "server", res.status);
    const p = z.object({ text: z.string() }).safeParse(json);
    if (!p.success) throw new ServiceError("Transcription returned an unexpected shape.", "invalid_response");
    return p.data;
  },
  async speak(text: string) {
    const res = await fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!res || !res.ok) throw new ServiceError("Mela's voice is unavailable right now.", res?.status === 503 ? "not_connected" : "server", res?.status);
    return res.blob();
  },
};
