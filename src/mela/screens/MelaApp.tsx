"use client";
import { useEffect, useRef } from "react";
import { MelaProvider, useMela } from "../state/MelaProvider";
import { reachable, type Step } from "../state/flow";
import { MelaOrb } from "../ui/MelaOrb";
import { Badge, Button, Icon } from "../ui/primitives";
import { formatDate } from "../domain/util";
import * as fx from "../fixtures/oakland-baby-shower";
import { WelcomeScreen } from "./WelcomeScreen";
import { ShapeScreen } from "./ShapeScreen";
import { DiscoverScreen } from "./DiscoverScreen";
import { DecideScreen } from "./DecideScreen";
import { ContactScreen } from "./ContactScreen";
import { HandoffScreen, OpsScreen } from "./OpsScreens";
import { SummaryScreen } from "./SummaryScreen";

export function MelaApp() {
  return (
    <MelaProvider>
      <Shell />
    </MelaProvider>
  );
}

const HOST_STEPS: { step: Step; label: string }[] = [
  { step: "shape", label: "Shape" },
  { step: "discover", label: "Discover" },
  { step: "decide", label: "Decide" },
  { step: "contact", label: "Contact" },
];

function Shell() {
  const { state, hydrated } = useMela();
  const main = useRef<HTMLElement>(null);
  // move focus to the new screen's heading on step change, for keyboard and screen-reader users
  useEffect(() => {
    if (!hydrated) return;
    const h = main.current?.querySelector<HTMLElement>("h1");
    h?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [state.step, hydrated]);

  if (!hydrated) return <div className="min-h-screen bg-night" aria-busy="true" />;
  if (state.step === "welcome") return <WelcomeScreen />;
  const ops = state.step === "ops" || state.step === "handoff";
  return (
    <div className={`min-h-screen ${ops ? "bg-[#ece4da]" : "bg-app"}`}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      {ops ? <OpsBar /> : <HostBar />}
      <ErrorToast />
      <main id="main" ref={main} className="mx-auto w-full max-w-[1280px] px-4 pb-28 pt-6 sm:px-8">
        {state.step === "shape" && <ShapeScreen />}
        {state.step === "discover" && <DiscoverScreen />}
        {state.step === "decide" && <DecideScreen />}
        {state.step === "contact" && <ContactScreen />}
        {state.step === "handoff" && <HandoffScreen />}
        {state.step === "ops" && <OpsScreen />}
        {state.step === "summary" && <SummaryScreen />}
      </main>
    </div>
  );
}

function ModeBadge() {
  const { service } = useMela();
  const live = Object.entries(service.live).filter(([, v]) => v).map(([k]) => k);
  return live.length
    ? <Badge kind="live" title={`Live: ${live.join(", ")}. Everything else uses labeled demo fixtures.`}>Live: {live.join(", ")}</Badge>
    : <Badge kind="fixture" title="Research, calls and finance use labeled demo fixtures. Nothing is sent anywhere.">Demo data</Badge>;
}

function HostBar() {
  const { state, go, reset } = useMela();
  const can = reachable(state);
  const b = state.brief;
  const idx = HOST_STEPS.findIndex((s) => s.step === state.step);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-app/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-3 px-4 sm:px-8">
        <button onClick={() => { if (confirm("Start over? Your current brief will be cleared.")) reset(); }} className="flex items-center gap-2" aria-label="Mela — start over">
          <MelaOrb size={28} state="idle" decorative />
          <span className="hidden font-serif text-[26px] leading-none sm:inline">mela.</span>
        </button>
        {b && (
          <span className="hidden items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-[13px] lg:inline-flex">
            <Icon name="calendar" size={14} />
            {[b.occasion || "Event", b.city || "City?", b.dateTarget ? formatDate(b.dateTarget) : "Date?"].join(" · ")}
          </span>
        )}
        <nav aria-label="Planning steps" className="mx-auto min-w-0 overflow-x-auto">
          <ol className="flex items-center gap-1 text-[14px]">
            {HOST_STEPS.map((s, i) => {
              const current = s.step === state.step;
              const done = idx > i || (state.step === "summary" && can[s.step]);
              return (
                <li key={s.step} className="flex items-center gap-1">
                  {i > 0 && <Icon name="arrow" size={13} className="text-faint" />}
                  <button disabled={!can[s.step]} onClick={() => go(s.step)} aria-current={current ? "step" : undefined}
                    className={`whitespace-nowrap rounded-lg px-2 py-1.5 sm:px-2.5 ${current ? "bg-primary-soft text-primary" : can[s.step] ? "text-muted hover:bg-primary-soft" : "text-faint/60 cursor-not-allowed"}`}>
                    {done && !current ? <Icon name="check" size={13} className="mr-1 inline" /> : <span className="mr-1 font-mono text-[11px]">{i + 1}</span>}
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <ModeBadge />
          {state.step !== "summary" && b && <Button size="sm" variant="ghost" onClick={() => go("summary")}>Summary</Button>}
        </div>
      </div>
    </header>
  );
}

function OpsBar() {
  const { state, go } = useMela();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-[#f3ece2]/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-3 px-4 sm:px-8">
        <MelaOrb size={28} state="handoff" decorative />
        <span className="font-serif text-[24px] leading-none">mela events</span>
        <span className="label-mono hidden sm:inline">Operations</span>
        {state.financeCase && <span className="hidden rounded-lg bg-subtle px-2.5 py-1 font-mono text-[12px] lg:inline">{state.financeCase.eventLabel}</span>}
        <div className="ml-auto flex items-center gap-2">
          <Badge kind="simulated">Simulated record</Badge>
          <span className="rounded-full bg-[#2f4f6b] px-3 py-1 text-[13px] font-medium text-white">{fx.scenario.manager.name.split(" ")[0]} · AP manager</span>
          {state.step === "ops" && <Button size="sm" variant="ghost" icon="back" onClick={() => go("summary")}>Back to host</Button>}
        </div>
      </div>
    </header>
  );
}

function ErrorToast() {
  const { error, clearError } = useMela();
  if (!error) return null;
  const notConnected = error.kind === "not_connected";
  return (
    <div role="alert" className="anim-rise fixed bottom-6 left-1/2 z-50 flex w-[min(640px,calc(100vw-32px))] -translate-x-1/2 items-start gap-3 rounded-2xl border border-warn/30 bg-surface p-4 shadow-xl">
      <MelaOrb size={40} state={notConnected ? "uncertain" : "error"} decorative />
      <div className="flex-1 text-[14px]">
        <p className="font-medium">{notConnected ? "That part isn't connected yet" : "That didn't work"}</p>
        <p className="text-muted">{error.message}</p>
        {notConnected && <p className="mt-1 text-[12px] text-faint">Nothing was faked to fill the gap. Set NEXT_PUBLIC_MELA_LIVE without this capability to use the labeled demo instead.</p>}
      </div>
      {error.retry && <Button size="sm" variant="secondary" onClick={() => { clearError(); error.retry!(); }}>Try again</Button>}
      <Button size="sm" variant="ghost" onClick={clearError} aria-label="Dismiss"><Icon name="x" /></Button>
    </div>
  );
}
