"use client";
// P01 Opening (Figma 92:2), copy from the build plan §2. One invitation; Talk and Type equal.
import { useState } from "react";
import { useMela } from "../state/MelaProvider";
import { MelaOrb, type OrbState } from "../ui/MelaOrb";
import { Composer } from "../ui/Composer";
import { Button } from "../ui/primitives";
import type { VoicePhase } from "../ui/useVoice";
import * as fx from "../fixtures/oakland-baby-shower";

export function WelcomeScreen() {
  const { say, busy, service, state, go } = useMela();
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const orb: OrbState = phase === "listening" || phase === "requesting" ? "listening" : phase === "transcribing" || busy === "intake" ? "thinking" : phase === "denied" ? "uncertain" : "inviting";
  const anyLive = Object.values(service.live).some(Boolean);
  return (
    <div className="on-night relative min-h-screen overflow-hidden bg-night text-white">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-18%] h-[560px] w-[560px] max-w-[140vw] -translate-x-1/2 rounded-full opacity-60 blur-3xl" style={{ background: "radial-gradient(circle, #8f72c9 0%, rgba(143,114,201,0.22) 45%, transparent 70%)" }} />
      <header className="relative z-10 mx-auto flex max-w-[1200px] items-center justify-between px-5 py-5 sm:px-10 sm:py-6">
        <span className="font-serif text-[26px] leading-none">mela.</span>
        {state.brief && <Button variant="onNight" size="sm" iconRight="arrow" onClick={() => go("shape")}>Continue your event</Button>}
      </header>
      <main id="main" className="relative z-10 mx-auto flex max-w-[640px] flex-col items-center px-5 pb-14 pt-4 text-center sm:pt-10">
        <div className="anim-rise"><MelaOrb state={orb} size={104} onNight /></div>
        <p className="anim-rise mt-6 text-[15px] text-white/70" style={{ animationDelay: "60ms" }}>Hello, I&apos;m Mela.</p>
        <h1 tabIndex={-1} className="t-display anim-rise mt-2 outline-none sm:text-[50px]" style={{ animationDelay: "100ms" }}>
          How can I help you plan the event of your dreams?
        </h1>
        <p className="anim-rise mt-4 max-w-[480px] text-[16px] leading-7 text-white/70" style={{ animationDelay: "160ms" }}>
          Tell Mela about your event. She finds options with sources, and you decide what happens next.
        </p>
        <div className="anim-rise mt-9 w-full" style={{ animationDelay: "220ms" }}>
          <Composer onNight autoFocus onSend={say} busy={busy === "intake"} placeholder="Type your dream event here…" onVoicePhase={setPhase} />
        </div>
        <div className="anim-rise mt-6 flex flex-col items-center gap-2" style={{ animationDelay: "260ms" }}>
          <Button variant="onNight" iconRight="arrow" onClick={() => say(fx.scenario.exampleText)} disabled={busy === "intake"}>Try the demo example</Button>
          <span className="text-[13px] text-white/55">{fx.scenario.title}, 75–100 guests</span>
        </div>
        <p className="mt-14 max-w-[460px] text-[12px] leading-5 text-white/50">
          Mela never books, sends, calls or pays without your approval.{" "}
          {anyLive ? "Some features are connected live; each result shows where it came from." : "Demo mode: research, calls and finance use clearly labeled fictional data."}
        </p>
      </main>
    </div>
  );
}
