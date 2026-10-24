"use client";
// P14 Return (98:2438): what's chosen, what's confirmed, what's unknown, what's left, what Mela actually did.
import { formatTime } from "../domain/util";
import { useMela } from "../state/MelaProvider";
import { useRecommendations } from "../state/derived";
import { MelaOrb } from "../ui/MelaOrb";
import { Badge, Button, Card, Icon, SectionLabel } from "../ui/primitives";
import { finalStatus } from "./OpsScreens";

export function SummaryScreen() {
  const { state, go, reset } = useMela();
  const { recById, vendorsById } = useRecommendations();
  const venue = state.selected.venue ? vendorsById.get(state.selected.venue) : undefined;
  const caterer = state.selected.catering ? vendorsById.get(state.selected.catering) : undefined;
  const vRec = venue && recById.get(venue.id);
  const cRec = caterer && recById.get(caterer.id);
  const called = state.attempt && state.callPlan && state.attempt.callPlanId === state.callPlan.id ? state.attempt : null;

  const confirmed = [
    ...(vRec?.checks.filter((c) => c.result === "meets").map((c) => `${venue!.name}: ${c.label} — ${c.note}`) ?? []),
    ...(cRec?.checks.filter((c) => c.result === "meets").map((c) => `${caterer!.name}: ${c.label} — ${c.note}`) ?? []),
  ];
  const unknown = [
    ...(vRec?.unknowns.map((u) => `${venue!.name}: ${u}`) ?? []),
    ...(cRec?.unknowns.map((u) => `${caterer!.name}: ${u}`) ?? []),
    ...(state.outcome?.answers.filter((a) => a.status === "not_answered").map((a) => `Unanswered on the call: ${a.question}`) ?? []),
  ];
  const todo = [
    !venue && "Choose a venue",
    !caterer && "Choose a caterer",
    venue && !called && `Contact ${venue.name} — Mela hasn't`,
    venue && called && `Get ${venue.name}'s quote and terms in writing (the call answers are verbal only)`,
    venue && `Sign ${venue.name}'s contract and pay its deposit yourself, once you've read the terms`,
    caterer && `Ask ${caterer.name} for a written quote for ${state.brief?.guestRange?.max ?? "your"} guests`,
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-[920px] space-y-6">
      <div className="flex items-center gap-4">
        <MelaOrb state="succeeded" size={64} />
        <div>
          <SectionLabel>Your event · where things stand</SectionLabel>
          <h1 tabIndex={-1} className="font-serif text-[36px] leading-tight outline-none">Here&apos;s everything, honestly</h1>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <SectionLabel>Selected</SectionLabel>
          <ul className="mt-2 space-y-2 text-[15px]">
            <li className="flex items-center justify-between gap-2"><span>Venue: <strong>{venue?.name ?? "not chosen"}</strong></span>{venue && <Badge kind="draft">Chosen · not booked</Badge>}</li>
            <li className="flex items-center justify-between gap-2"><span>Caterer: <strong>{caterer?.name ?? "not chosen"}</strong></span>{caterer && <Badge kind="draft">Chosen · not contacted</Badge>}</li>
          </ul>
          {(venue?.fictional || caterer?.fictional) && <p className="mt-2 text-[12px] text-faint">Demo vendors are fictional.</p>}
        </Card>
        <Card className="p-5">
          <SectionLabel>Contact</SectionLabel>
          <p className="mt-2 text-[15px]">
            {called ? <>{called.mode === "simulated" ? "Simulated call" : called.mode === "role_play" ? "Role-play call" : "Call"} to {state.callPlan!.vendorName}: <strong>{called.state}</strong>.</> : venue ? <>{venue.name}: <strong>not contacted</strong>.</> : "No one was contacted."}
          </p>
          {state.outcome && <p className="mt-1 text-[13px] text-muted">{state.outcome.availability === "vendor_said_verbally" ? "The vendor said the date is open — verbally. That isn't a hold or a booking." : "Availability still needs confirmation."}</p>}
        </Card>
      </div>

      <List title="Confirmed by sources" icon="check" tone="text-ok" items={confirmed} empty="Nothing confirmed yet." />
      <List title="Still unknown" icon="question" tone="text-unk" items={unknown} empty="No open unknowns on your choices." />
      <List title="What's left for you" icon="arrow" tone="text-primary" items={todo} empty="" />

      {state.financeCase && (
        <Card className="p-5">
          <SectionLabel>Mela Events finance (simulated)</SectionLabel>
          <p className="mt-2 text-[15px]">{finalStatus(state.financeCase)}</p>
        </Card>
      )}

      <Card className="p-5">
        <SectionLabel>What Mela actually did</SectionLabel>
        <ol className="mt-3 space-y-2 text-[14px]">
          {state.actions.length === 0 && <li className="text-muted">Nothing yet.</li>}
          {state.actions.map((a) => (
            <li key={a.id} className="flex gap-3">
              <span className="w-[110px] shrink-0 font-mono text-[12px] text-faint">{formatTime(a.at)}</span>
              <span>{a.action}{a.detail && <span className="block text-[12px] text-faint">{a.detail}</span>}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 rounded-lg bg-subtle px-3 py-2 text-[13px] text-muted">Mela did not book anything, send email, sign anything, or move money.</p>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon="back" onClick={() => go(state.research ? "decide" : "shape")}>Keep planning</Button>
        <Button variant="ghost" onClick={() => go("shape")}>Edit brief</Button>
        <Button variant="ghost" onClick={() => { if (confirm("Start a new event? This clears the current one.")) reset(); }}>Start a new event</Button>
      </div>
    </div>
  );
}

function List({ title, icon, tone, items, empty }: { title: string; icon: "check" | "question" | "arrow"; tone: string; items: string[]; empty: string }) {
  if (!items.length && !empty) return null;
  return (
    <Card className="p-5">
      <SectionLabel>{title}</SectionLabel>
      {items.length ? (
        <ul className="mt-2 space-y-1.5 text-[14px]">{items.map((t) => <li key={t} className="flex gap-2"><Icon name={icon} size={15} className={`mt-0.5 shrink-0 ${tone}`} />{t}</li>)}</ul>
      ) : <p className="mt-2 text-[14px] text-muted">{empty}</p>}
    </Card>
  );
}
