"use client";
// P01 Opening (Figma 92:2), copy from the build plan §2. One invitation; Talk and Type equal.
import { useState } from "react";
import { useMela } from "../state/MelaProvider";
import { MelaOrb, type OrbState } from "../ui/MelaOrb";
import { Composer } from "../ui/Composer";
import type { VoicePhase } from "../ui/useVoice";
import * as fx from "../fixtures/oakland-baby-shower";

export function WelcomeScreen() {
  const { say, busy, service, state, go } = useMela();
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const orb: OrbState = phase === "listening" || phase === "requesting" ? "listening" : phase === "transcribing" || busy === "intake" ? "thinking" : phase === "denied" ? "uncertain" : "inviting";
  const anyLive = Object.values(service.live).some(Boolean);
  return (
    <div className="on-night relative min-h-screen overflow-hidden bg-night text-white">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-12%] h-[620px] w-[620px] -translate-x-1/2 rounded-full opacity-70 blur-3xl" style={{ background: "radial-gradient(circle, #8f72c9 0%, rgba(143,114,201,0.25) 45%, transparent 70%)" }} />
      <div aria-hidden className="pointer-events-none absolute bottom-[-20%] right-[-10%] h-[520px] w-[520px] rounded-full opacity-60 blur-3xl" style={{ background: "radial-gradient(circle, #c2571f 0%, rgba(194,87,31,0.25) 45%, transparent 70%)" }} />
      <header className="relative z-10 mx-auto flex max-w-[1280px] items-center justify-between px-6 py-6 sm:px-10">
        <span className="font-serif text-[30px] leading-none">mela.</span>
        {state.brief && <button className="rounded-xl border border-white/20 px-3 py-2 text-[13px] hover:bg-white/10" onClick={() => go("shape")}>Continue your event →</button>}
      </header>
      <main id="main" className="relative z-10 mx-auto flex max-w-[760px] flex-col items-center px-6 pb-16 pt-6 text-center sm:pt-10">
        <div className="anim-rise"><MelaOrb state={orb} size={132} onNight /></div>
        <p className="anim-rise mt-6 text-[17px] text-white/80" style={{ animationDelay: "80ms" }}>Hello, I&apos;m Mela.</p>
        <h1 tabIndex={-1} className="anim-rise mt-2 font-serif text-[40px] leading-[1.05] tracking-[-0.01em] outline-none sm:text-[56px]" style={{ animationDelay: "140ms" }}>
          How can I help you plan the event of your dreams?
        </h1>
        <p className="anim-rise mt-5 max-w-[560px] text-[17px] leading-7 text-white/75" style={{ animationDelay: "200ms" }}>
          Tell me what you are imagining. I will help you find thoughtful options, and you decide what happens next.
        </p>
        <div className="anim-rise mt-10 w-full" style={{ animationDelay: "260ms" }}>
          <Composer onNight autoFocus onSend={say} busy={busy === "intake"} placeholder="Type your dream event here..." onVoicePhase={setPhase} />
        </div>
        <button className="mt-5 text-[13px] text-white/70 underline decoration-white/30 underline-offset-4 hover:text-white" onClick={() => say(fx.scenario.exampleText)}>
          Try the demo example: {fx.scenario.title}, 75–100 guests
        </button>
        <p className="mt-14 max-w-[600px] font-mono text-[11px] leading-5 tracking-wide text-white/50">
          Mela never books, sends, calls or pays without your approval.{" "}
          {anyLive ? "Some features are connected live; each result shows where it came from." : "Demo mode: research, calls and finance use clearly labeled fictional fixtures."}
        </p>
      </main>
    </div>
  );
}
