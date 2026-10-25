"use client";
// P14 Return (98:2438): what's chosen, what's confirmed, what's unknown, what's left, what Mela actually did.
import { formatTime } from "../domain/util";
import { useMela } from "../state/MelaProvider";
import { useRecommendations } from "../state/derived";
import { MelaOrb } from "../ui/MelaOrb";
import type { ReactNode } from "react";
import { Badge, Button, Card, Disclosure, Icon, Note, PageHeader } from "../ui/primitives";
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
    ...(vRec ? [{ vendor: venue!.name, items: vRec.checks.filter((c) => c.result === "meets").map((c) => `${c.label}: ${c.note}`) }] : []),
    ...(cRec ? [{ vendor: caterer!.name, items: cRec.checks.filter((c) => c.result === "meets").map((c) => `${c.label}: ${c.note}`) }] : []),
  ].filter((g) => g.items.length);
  const confirmedCount = confirmed.reduce((n, g) => n + g.items.length, 0);
  const unknown = [
    ...(vRec?.unknowns.map((u) => `${venue!.name}: ${u}`) ?? []),
    ...(cRec?.unknowns.map((u) => `${caterer!.name}: ${u}`) ?? []),
    ...(state.outcome?.answers.filter((a) => a.status === "not_answered").map((a) => `Unanswered on the call: ${a.question}`) ?? []),
  ];
  const todo = [
    !venue && "Choose a venue",
    !caterer && "Choose a caterer",
    venue && !called && `Contact ${venue.name}. Mela hasn't.`,
    venue && called && `Get ${venue.name}'s quote and terms in writing (the call answers are verbal only)`,
    venue && `Sign ${venue.name}'s contract and pay its deposit yourself, once you've read the terms`,
    caterer && `Ask ${caterer.name} for a written quote for ${state.brief?.guestRange?.max ?? "your"} guests`,
  ].filter(Boolean) as string[];
  const contactLine = called
    ? `${called.mode === "simulated" ? "Simulated call" : called.mode === "role_play" ? "Role-play call" : "Call"}, ${called.state}`
    : venue ? "Not contacted" : "No one contacted";

  return (
    <div className="mx-auto max-w-[760px] space-y-8">
      <div className="flex items-center gap-4">
        <MelaOrb state="succeeded" size={52} />
        <PageHeader eyebrow="Where things stand" title="Here's everything, honestly" />
      </div>

      <Card className="divide-y divide-line">
        <Row label="Venue" value={venue?.name ?? "Not chosen"} badge={venue && <Badge kind="draft">Chosen · not booked</Badge>} />
        <Row label="Caterer" value={caterer?.name ?? "Not chosen"} badge={caterer && <Badge kind="draft">Chosen · not contacted</Badge>} />
        <Row label="Contact" value={contactLine}
          detail={state.outcome ? (state.outcome.availability === "vendor_said_verbally" ? "The vendor said the date is open, verbally. That isn't a hold or a booking." : "Availability still needs confirmation.") : undefined}
          badge={called?.mode === "simulated" ? <Badge kind="simulated">Simulated</Badge> : called?.mode === "role_play" ? <Badge kind="rolePlay">Role-play</Badge> : undefined} />
        {state.financeCase && <Row label="Finance" value={finalStatus(state.financeCase)} badge={<Badge kind="simulated">Simulated</Badge>} />}
        {(venue?.fictional || caterer?.fictional) && <p className="px-4 py-2.5 text-[12px] text-faint sm:px-5">Demo vendors are fictional.</p>}
      </Card>

      {todo.length > 0 && (
        <section aria-labelledby="todo-h">
          <h2 id="todo-h" className="text-[18px] font-medium">What&apos;s left for you</h2>
          <ul className="mt-3 space-y-2 text-[15px]">{todo.map((t) => <li key={t} className="flex gap-2.5"><Icon name="arrow" size={15} className="mt-1 shrink-0 text-primary" />{t}</li>)}</ul>
        </section>
      )}

      <section aria-labelledby="unk-h">
        <h2 id="unk-h" className="text-[18px] font-medium">Still unknown</h2>
        {unknown.length
          ? <ul className="mt-3 space-y-2 text-[15px]">{unknown.map((t) => <li key={t} className="flex gap-2.5"><Icon name="question" size={15} className="mt-1 shrink-0 text-unk" />{t}</li>)}</ul>
          : <p className="t-small mt-2">No open unknowns on your choices.</p>}
      </section>

      <div className="space-y-3">
        {confirmedCount > 0 && (
          <Disclosure summary="Confirmed by sources" meta={`${confirmedCount} facts`}>
            <div className="space-y-4">
              {confirmed.map((g) => (
                <div key={g.vendor}>
                  <p className="label-mono">{g.vendor}</p>
                  <ul className="mt-1.5 space-y-1.5 text-[14px]">{g.items.map((t) => <li key={t} className="flex gap-2"><Icon name="check" size={14} className="mt-1 shrink-0 text-ok" />{t}</li>)}</ul>
                </div>
              ))}
            </div>
          </Disclosure>
        )}
      </div>

      <section aria-labelledby="did-h" className="space-y-3">
        <h2 id="did-h" className="text-[18px] font-medium">What Mela did, and didn&apos;t do</h2>
        <Note icon="lock" className="!text-[14px]">Mela did not book anything, send email, sign anything, or move money.</Note>
        <ol className="space-y-2.5 text-[14px]">
          {state.actions.length === 0 && <li className="text-muted">Nothing yet.</li>}
          {state.actions.map((a) => (
            <li key={a.id} className="grid gap-x-3 sm:grid-cols-[110px_minmax(0,1fr)]">
              <span className="font-mono text-[12px] text-faint sm:pt-0.5">{formatTime(a.at)}</span>
              <span>{a.action}{a.detail && <span className="block text-[12px] text-faint">{a.detail}</span>}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-wrap gap-2 border-t border-line pt-6">
        <Button icon="back" onClick={() => go(state.research ? "decide" : "shape")}>Keep planning</Button>
        <Button variant="ghost" onClick={() => go("shape")}>Edit brief</Button>
        <Button variant="ghost" onClick={() => { if (confirm("Start a new event? This clears the current one.")) reset(); }}>Start a new event</Button>
      </div>
    </div>
  );
}

function Row({ label, value, detail, badge }: { label: string; value: string; detail?: string; badge?: ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-1 px-4 py-3.5 sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:items-start sm:px-5">
      <p className="label-mono sm:pt-0.5">{label}</p>
      <div className="min-w-0">
        <p className="text-[15px] font-medium">{value}</p>
        {detail && <p className="t-small mt-0.5">{detail}</p>}
      </div>
      {badge && <div className="sm:pt-0.5">{badge}</div>}
    </div>
  );
}
