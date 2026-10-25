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
    <div className={`min-h-screen ${ops ? "bg-ops" : "bg-app"}`}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      {ops ? <OpsBar /> : <HostBar />}
      <ErrorToast />
      <main id="main" ref={main} className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-8 sm:px-8 sm:pt-10">
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
  const current = HOST_STEPS[idx];
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-app/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 sm:h-16 sm:px-8">
        <button onClick={() => { if (confirm("Start over? Your current brief will be cleared.")) reset(); }} className="flex shrink-0 items-center gap-2 rounded-full" aria-label="Mela, start over">
          <MelaOrb size={28} state="idle" decorative />
          <span className="hidden font-serif text-[24px] leading-none md:inline">mela.</span>
        </button>
        {b && (
          <span className="hidden min-w-0 truncate text-[13px] text-faint xl:inline" title="Your event">
            {[b.occasion || "Event", b.city || "City?", b.dateTarget ? formatDate(b.dateTarget) : "Date?"].join(" · ")}
          </span>
        )}
        <nav aria-label="Planning steps" className="mx-auto min-w-0">
          <ol className="flex items-center gap-0.5 text-[14px] sm:gap-1">
            {HOST_STEPS.map((s, i) => {
              const isCurrent = s.step === state.step;
              const done = idx > i || (state.step === "summary" && can[s.step]);
              return (
                <li key={s.step} className="flex items-center">
                  {i > 0 && <span aria-hidden className={`mx-1 hidden h-px w-4 sm:block lg:w-6 ${done || isCurrent ? "bg-primary/40" : "bg-line-strong"}`} />}
                  <button disabled={!can[s.step]} onClick={() => go(s.step)} aria-current={isCurrent ? "step" : undefined}
                    aria-label={`${i + 1}. ${s.label}${done && !isCurrent ? " (done)" : ""}`}
                    className={`flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full py-1 pl-1.5 transition-colors ${isCurrent ? "pr-3" : "pr-1.5 sm:pr-3"} ${isCurrent ? "bg-primary-soft font-medium text-primary" : can[s.step] ? "text-muted hover:bg-primary-soft hover:text-fg" : "cursor-not-allowed text-faint/60"}`}>
                    <span aria-hidden className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${isCurrent ? "bg-primary text-white" : done ? "bg-primary/15 text-primary" : "ring-1 ring-inset ring-line-strong"}`}>
                      {done && !isCurrent ? <Icon name="check" size={11} /> : i + 1}
                    </span>
                    <span className={isCurrent ? "" : "hidden sm:inline"}>{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="flex shrink-0 items-center gap-1.5">
          <ModeBadge />
          {state.step !== "summary" && b && <span className="hidden md:block"><Button size="sm" variant="ghost" onClick={() => go("summary")}>Summary</Button></span>}
        </div>
      </div>
    </header>
  );
}

function OpsBar() {
  const { state, go } = useMela();
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-ops/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 sm:h-16 sm:px-8">
        <MelaOrb size={28} state="handoff" decorative />
        <span className="min-w-0 truncate">
          <span className="font-serif text-[22px] leading-none">mela events</span>
          <span className="ml-2 hidden text-[13px] text-faint sm:inline">Operations</span>
        </span>
        {state.financeCase && <span className="hidden truncate text-[13px] text-faint xl:inline">{state.financeCase.eventLabel}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Badge kind="simulated" title="The quote, invoice and payment draft are simulated. No money moves.">Simulated</Badge>
          <span className="rounded-full bg-research px-2.5 py-1 text-[12px] font-medium text-white" title="You are acting as the AP manager">
            {fx.scenario.manager.name.split(" ")[0]}<span className="hidden sm:inline"> · AP manager</span>
          </span>
          {state.step === "ops" && <Button size="sm" variant="ghost" icon="back" onClick={() => go("summary")} aria-label="Back to host" className="!px-2 md:!px-3"><span className="hidden md:inline">Back to host</span></Button>}
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
    <div role="alert" className="anim-rise fixed bottom-4 left-1/2 z-50 flex w-[min(600px,calc(100vw-32px))] -translate-x-1/2 flex-wrap items-start gap-3 rounded-2xl bg-surface p-4 shadow-float ring-1 ring-warn/30">
      <MelaOrb size={36} state={notConnected ? "uncertain" : "error"} decorative />
      <div className="min-w-0 flex-1 text-[14px]">
        <p className="font-medium">{notConnected ? "That part isn't connected yet" : "That didn't work"}</p>
        <p className="text-muted">{error.message}</p>
        {notConnected && <p className="mt-1 text-[12px] text-faint">Nothing was faked to fill the gap. Set NEXT_PUBLIC_MELA_LIVE without this capability to use the labeled demo instead.</p>}
      </div>
      {error.retry && <Button size="sm" variant="secondary" onClick={() => { clearError(); error.retry!(); }}>Try again</Button>}
      <Button size="sm" variant="ghost" onClick={clearError} aria-label="Dismiss"><Icon name="x" /></Button>
    </div>
  );
}
