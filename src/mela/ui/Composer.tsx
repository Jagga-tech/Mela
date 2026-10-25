"use client";
// Voice Dock (Figma 88:305): Talk and Type are equal. Voice text lands in the box so the host can check it before sending.
// Layout: a full-width text box that grows with the text, and a toolbar under it (Talk on the left, Send on the right).
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "./primitives";
import { ENGINE_LABEL, useVoice, type VoicePhase } from "./useVoice";

const MAX_TEXTAREA_PX = 220;

export function Composer({ onSend, busy, placeholder, onNight = false, autoFocus = false, onVoicePhase }: {
  onSend: (text: string) => void; busy?: boolean; placeholder: string; onNight?: boolean; autoFocus?: boolean; onVoicePhase?: (p: VoicePhase) => void;
}) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const voice = useVoice((heard) => setText((t) => (t ? t + " " : "") + heard));
  const listening = voice.phase === "listening" || voice.phase === "requesting";
  const transcribing = voice.phase === "transcribing";
  const canSend = text.trim().length > 0 && !busy;
  useEffect(() => onVoicePhase?.(voice.phase), [voice.phase, onVoicePhase]);

  // Grow with the text, up to a limit, then scroll.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [text]);

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

  // Explicit classes per state, not layered on a Button variant: two bg-* utilities on one
  // element resolve by stylesheet order, which is why the old Send button never turned white.
  const t = onNight
    ? {
        shell: "bg-white/[0.08] border-white/15 focus-within:border-white/35 focus-within:bg-white/[0.11]",
        field: "text-white placeholder:text-white/50",
        talk: listening ? "bg-white text-night" : "bg-white/10 text-white hover:bg-white/20 border border-white/20",
        sendOn: "bg-white text-night hover:bg-white/90 shadow-[0_6px_20px_-6px_rgba(255,255,255,0.45)]",
        sendOff: "bg-white/10 text-white/40",
        hint: "text-white/55",
      }
    : {
        shell: "bg-surface border-line focus-within:border-primary/50",
        field: "text-fg placeholder:text-faint",
        talk: listening ? "bg-primary text-white" : "bg-subtle text-fg hover:bg-primary-soft border border-line",
        sendOn: "bg-primary text-white hover:bg-primary-hover",
        sendOff: "bg-subtle text-faint",
        hint: "text-faint",
      };

  return (
    <form onSubmit={submit} className="w-full text-left">
      <div className={`rounded-[26px] border px-2 pb-2 pt-1 transition-colors duration-150 ${t.shell}`}>
        <label className="sr-only" htmlFor="mela-composer">Describe your event</label>
        <textarea
          id="mela-composer" ref={box} value={text} rows={3} autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder={placeholder}
          className={`block w-full resize-none bg-transparent px-4 pb-2 pt-4 text-[16px] leading-7 outline-none ${t.field}`}
          style={{ maxHeight: MAX_TEXTAREA_PX }}
        />
        <div className="flex items-center justify-between gap-3 px-1">
          <button
            type="button" aria-pressed={listening} title={ENGINE_LABEL[voice.engine]}
            disabled={voice.engine === "none" || transcribing}
            onClick={() => (listening ? voice.stop() : voice.start())}
            className={`inline-flex h-11 items-center gap-2 rounded-full px-4 text-[14px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${t.talk}`}>
            <Icon name={transcribing ? "spinner" : listening ? "pause" : "mic"} />
            {listening ? "Stop" : transcribing ? "Hearing you…" : "Talk"}
          </button>
          <span className={`hidden flex-1 truncate text-center text-[12px] sm:block ${t.hint}`} aria-live="polite">
            {listening ? "Listening… press Stop when you're done" : "Enter to send · Shift+Enter for a new line"}
          </span>
          <button
            type="submit" disabled={!canSend} aria-busy={busy || undefined}
            className={`inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-semibold transition-all duration-150 disabled:cursor-not-allowed ${canSend || busy ? t.sendOn : t.sendOff}`}>
            <Icon name={busy ? "spinner" : "send"} />
            Send
          </button>
        </div>
      </div>
      <p className={`mt-2 px-3 text-[12px] ${t.hint}`} aria-live="polite">
        {listening && <span className="sm:hidden">Listening… press Stop when you&apos;re done · </span>}
        {voice.message ?? ENGINE_LABEL[voice.engine]}
      </p>
    </form>
  );
}
