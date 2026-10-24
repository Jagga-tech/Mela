"use client";
// Voice Dock (Figma 88:305): Talk and Type are equal. Voice text lands in the box so the host can check it before sending.
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "./primitives";
import { ENGINE_LABEL, useVoice, type VoicePhase } from "./useVoice";

export function Composer({ onSend, busy, placeholder, onNight = false, autoFocus = false, onVoicePhase }: {
  onSend: (text: string) => void; busy?: boolean; placeholder: string; onNight?: boolean; autoFocus?: boolean; onVoicePhase?: (p: VoicePhase) => void;
}) {
  const [text, setText] = useState("");
  const voice = useVoice((heard) => setText((t) => (t ? t + " " : "") + heard));
  const listening = voice.phase === "listening" || voice.phase === "requesting";
  useEffect(() => onVoicePhase?.(voice.phase), [voice.phase, onVoicePhase]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const shell = onNight ? "bg-white/[0.07] border-white/15" : "bg-surface border-line";
  const field = onNight ? "bg-white/[0.06] text-white placeholder:text-white/55" : "bg-app text-fg placeholder:text-faint";
  return (
    <form onSubmit={submit} className="w-full">
      <div className={`flex flex-col gap-2 rounded-[22px] border p-2 sm:flex-row sm:items-stretch ${shell}`}>
        <Button type="button" variant={onNight ? "primary" : "secondary"} size="lg" icon={listening ? "pause" : "mic"}
          className={onNight ? "bg-[#8b6cc4] hover:bg-[#7a5bb3] min-w-[150px]" : "min-w-[150px]"}
          disabled={voice.engine === "none" || voice.phase === "transcribing"} loading={voice.phase === "transcribing"}
          aria-pressed={listening} onClick={() => (listening ? voice.stop() : voice.start())}
          title={ENGINE_LABEL[voice.engine]}>
          {listening ? "Stop" : voice.phase === "transcribing" ? "Hearing you…" : "Talk to Mela"}
        </Button>
        <label className="sr-only" htmlFor="mela-composer">Describe your event</label>
        <textarea id="mela-composer" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={2} autoFocus={autoFocus}
          placeholder={placeholder} className={`min-h-12 flex-1 resize-none rounded-2xl px-4 py-3 text-[15px] leading-6 ${field}`} />
        <Button type="submit" size="lg" icon="send" disabled={!text.trim()} loading={busy} className={onNight ? "bg-white text-primary hover:bg-white/90" : ""}>
          Send
        </Button>
      </div>
      <div className={`mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] ${onNight ? "text-white/60" : "text-faint"}`} aria-live="polite">
        <span className="font-mono tracking-wide">{listening ? "Listening… press Stop when you're done" : "Enter to send · Shift+Enter for a new line"}</span>
        <span>{voice.message ?? ENGINE_LABEL[voice.engine]}</span>
      </div>
    </form>
  );
}
