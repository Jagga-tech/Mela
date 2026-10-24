"use client";
// Voice input/output. Cartesia (server-proxied) when configured; otherwise the browser's own speech
// recognition, labeled as such; otherwise text only. Never blocks the text path.
import { useCallback, useEffect, useRef, useState } from "react";
import { useMela } from "../state/MelaProvider";

export type VoiceEngine = "cartesia" | "browser" | "none";
export type VoicePhase = "idle" | "requesting" | "listening" | "transcribing" | "speaking" | "denied" | "error";

type SpeechRec = { start(): void; stop(): void; abort(): void; lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };

function browserRecognizer(): SpeechRec | null {
  if (typeof window === "undefined") return null;
  const C = (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
  return C ? new C() : null;
}

export const ENGINE_LABEL: Record<VoiceEngine, string> = {
  cartesia: "Voice: Cartesia (live)",
  browser: "Voice: your browser's speech recognition (Cartesia not configured)",
  none: "Voice isn't available here — typing works the same",
};

export function useVoice(onText: (text: string) => void) {
  const { service } = useMela();
  const [engine, setEngine] = useState<VoiceEngine>("none");
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const speech = useRef<SpeechRec | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    let alive = true;
    service.voiceStatus().then((s) => {
      if (!alive) return;
      setEngine(s.cartesia && typeof MediaRecorder !== "undefined" ? "cartesia" : browserRecognizer() ? "browser" : "none");
    });
    return () => { alive = false; };
  }, [service]);

  const fail = (e: unknown, denied = false) => {
    setPhase(denied ? "denied" : "error");
    setMessage(denied ? "Microphone access was declined. You can type instead, or allow the mic in your browser settings." : (e as Error)?.message || "Voice didn't work that time. Try again or type.");
  };

  const start = useCallback(async () => {
    setMessage(null);
    if (engine === "browser") {
      const r = browserRecognizer();
      if (!r) return fail(null);
      speech.current = r;
      r.lang = "en-US";
      r.interimResults = false;
      r.onresult = (e) => {
        const text = Array.from(e.results).map((x) => x[0].transcript).join(" ").trim();
        if (text) onTextRef.current(text);
      };
      r.onerror = (e) => fail(new Error(e.error), e.error === "not-allowed" || e.error === "service-not-allowed");
      r.onend = () => setPhase((p) => (p === "listening" ? "idle" : p));
      setPhase("listening");
      r.start();
      return;
    }
    if (engine !== "cartesia") return;
    setPhase("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      return fail(e, (e as DOMException)?.name === "NotAllowedError");
    }
    const chunks: Blob[] = [];
    const mr = new MediaRecorder(stream);
    rec.current = mr;
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setPhase("transcribing");
      try {
        const { text } = await service.transcribe(new Blob(chunks, { type: mr.mimeType || "audio/webm" }));
        setPhase("idle");
        if (text) onTextRef.current(text);
        else setMessage("I didn't hear anything — try again?");
      } catch (e) {
        fail(e);
      }
    };
    mr.start();
    setPhase("listening");
  }, [engine, service]);

  const stop = useCallback(() => {
    if (rec.current?.state === "recording") rec.current.stop();
    speech.current?.stop();
  }, []);

  const speak = useCallback(async (text: string) => {
    if (engine !== "cartesia") return;
    try {
      const blob = await service.speak(text);
      audio.current?.pause();
      const a = new Audio(URL.createObjectURL(blob));
      audio.current = a;
      setPhase("speaking");
      a.onended = () => setPhase("idle");
      await a.play();
    } catch {
      setPhase("idle"); // captions are always on screen, so a silent failure loses nothing
    }
  }, [engine, service]);

  const interrupt = useCallback(() => {
    audio.current?.pause();
    setPhase("idle");
  }, []);

  useEffect(() => () => {
    if (rec.current?.state === "recording") rec.current.stop();
    speech.current?.abort();
    audio.current?.pause();
  }, []);

  return { engine, phase, message, start, stop, speak, interrupt, clearMessage: () => setMessage(null) };
}
