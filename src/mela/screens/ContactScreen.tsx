"use client";
// P08 Consent (96:1543) adapted to the call gate: exact script, number source, shared vs private,
// one deliberate approval for one attempt, then honest call states and a verbal-only outcome.
import { useState } from "react";
import type { CallAttempt, CallState } from "../contracts";
import { APPROVAL_TTL_MS } from "../domain/calls";
import { formatTime, usd } from "../domain/util";
import { useMela } from "../state/MelaProvider";
import { MelaOrb, type OrbState } from "../ui/MelaOrb";
import { ActionBar, Badge, Button, Card, Dialog, Disclosure, Icon, Note, PageHeader, SectionLabel } from "../ui/primitives";

export function ContactScreen() {
  const { state, go, dispatch, prepareCall, busy } = useMela();
  const plan = state.callPlan;
  const venue = state.research?.vendors.find((v) => v.id === state.selected.venue);

  if (!plan) {
    return (
      <div className="mx-auto flex max-w-[560px] flex-col items-center gap-4 pt-6 text-center">
        <MelaOrb state="idle" size={64} />
        <h1 tabIndex={-1} className="t-title outline-none">Not contacted</h1>
        <p className="t-lede">{venue ? `${venue.name} has not been contacted. Nothing was sent or dialed.` : "Choose a venue first."}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {venue && <Button onClick={prepareCall} loading={busy === "call_plan"}>Prepare a call plan</Button>}
          <Button variant="secondary" onClick={() => go("decide")}>Back to compare</Button>
          <Button variant="ghost" onClick={() => go("summary")}>See summary</Button>
        </div>
      </div>
    );
  }
  const started = !!state.attempt && state.attempt.callPlanId === plan.id;
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`Call plan v${plan.version} · ${started ? "approved for one attempt" : "draft, not approved"}`}
        title={started ? `Calling ${plan.vendorName}` : `Review the call to ${plan.vendorName}`}
        lede={started ? "One attempt, exactly as approved." : "Nothing leaves Mela until you approve it. Here is who she would call, what she would say, and what she would share."}
        aside={plan.rolePlay && <Badge kind="rolePlay" title={plan.numberSource.label}>Role-play contact</Badge>} />
      {started ? <CallProgress attempt={state.attempt!} /> : <PlanReview />}
      {!started && (
        <ActionBar sticky note={<span className="flex items-start gap-2"><Icon name="lock" size={15} className="mt-0.5 shrink-0" />Approval covers this exact version and one attempt. Any edit needs a new approval.</span>}>
          <Button variant="ghost" onClick={() => { dispatch({ type: "call_plan", plan: null }); dispatch({ type: "did", action: `Did not contact ${plan.vendorName} (you cancelled the plan)` }); }}>Don&apos;t call</Button>
          <ApproveButton />
        </ActionBar>
      )}
    </div>
  );
}

function PlanReview() {
  const { state, editCallPlan } = useMela();
  const plan = state.callPlan!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(plan.questions);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Card className="min-w-0 space-y-6 p-5 sm:p-6">
        <div>
          <SectionLabel>Who Mela calls</SectionLabel>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[15px]"><Icon name="phone" size={15} className="text-muted" /><span className="font-medium">{plan.vendorName}</span><span className="font-mono text-[14px] text-muted">{plan.phoneNumber}</span></p>
          <p className="t-small mt-1">{plan.numberSource.label}</p>
        </div>
        <div>
          <SectionLabel>Mela opens with</SectionLabel>
          <p className="mt-2 rounded-xl border-l-[3px] border-primary/60 bg-primary-soft/50 px-4 py-3 text-[15px] leading-6">“{plan.disclosure} {plan.opening}”</p>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>She asks only these questions</SectionLabel>
            {!editing && <Button size="sm" variant="ghost" icon="edit" onClick={() => { setDraft(plan.questions); setEditing(true); }}>Edit</Button>}
          </div>
          {editing ? (
            <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); editCallPlan({ questions: draft.map((q) => q.trim()).filter(Boolean) }); setEditing(false); }}>
              {draft.map((q, i) => (
                <div key={i} className="flex gap-2">
                  <label className="sr-only" htmlFor={`q-${i}`}>Question {i + 1}</label>
                  <textarea id={`q-${i}`} rows={2} value={q} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? e.target.value : x)))} className="min-w-0 flex-1 rounded-lg bg-surface px-3 py-2 text-[15px] ring-1 ring-line-strong" />
                  <Button type="button" size="sm" variant="ghost" aria-label={`Remove question ${i + 1}`} onClick={() => setDraft(draft.filter((_, j) => j !== i))}><Icon name="x" /></Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm">Save as v{plan.version + 1}</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setDraft([...draft, ""])}>Add question</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <ol className="mt-2 space-y-2 text-[15px] leading-6">
              {plan.questions.map((q, i) => <li key={i} className="flex gap-3"><span className="w-4 shrink-0 text-right text-faint">{i + 1}</span><span>{q}</span></li>)}
            </ol>
          )}
        </div>
        <div>
          <SectionLabel>Mela will not agree to</SectionLabel>
          <ul className="mt-2 space-y-1 text-[14px] text-muted">{plan.mustNotAgreeTo.map((m) => <li key={m} className="flex gap-2"><Icon name="x" size={14} className="mt-1 shrink-0 text-warn" />{m}</li>)}</ul>
        </div>
      </Card>
      <Card className="h-fit min-w-0 p-5 sm:p-6">
        <SectionLabel>Shared with the venue</SectionLabel>
        <ul className="mt-2 divide-y divide-line text-[15px]">
          {plan.sharedDetails.map((d) => (
            <li key={d.key} className="flex items-start gap-2 py-2">
              <Icon name="check" size={15} className="mt-1 shrink-0 text-primary" />
              <span className="min-w-0"><span className="text-muted">{d.label}:</span> <span className="font-medium">{d.value}</span></span>
            </li>
          ))}
        </ul>
        <SectionLabel className="mt-5">Kept private</SectionLabel>
        <ul className="mt-2 divide-y divide-line text-[15px] text-muted">
          {plan.privateDetails.map((d) => (
            <li key={d} className="flex items-start gap-2 py-2"><Icon name="lock" size={15} className="mt-1 shrink-0" />{d}</li>
          ))}
        </ul>
        <p className="mt-4 text-[12px] text-faint">Script fingerprint <span className="font-mono">{plan.scriptHash}</span> · created {formatTime(plan.createdAt)}</p>
      </Card>
    </div>
  );
}

function ApproveButton() {
  const { state, approveAndCall, busy, service } = useMela();
  const plan = state.callPlan!;
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const simulated = !service.live.calls;
  return (
    <>
      <Button icon="phone" onClick={() => { setAck(false); setOpen(true); }}>Review &amp; approve one call</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Approve one call" labelledBy="approve-h">
        <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[14px] sm:grid-cols-[96px_minmax(0,1fr)]">
          <dt className="text-muted">Who</dt><dd className="font-medium">{plan.vendorName}{plan.rolePlay && " (role-played by a consenting teammate)"}</dd>
          <dt className="text-muted">Number</dt><dd className="font-mono">{plan.phoneNumber}</dd>
          <dt className="text-muted">Script</dt><dd>v{plan.version} · {plan.questions.length} questions · <span className="font-mono">{plan.scriptHash}</span></dd>
          <dt className="text-muted">Shares</dt><dd>{plan.sharedDetails.map((d) => d.label).join(", ")}</dd>
          <dt className="text-muted">Limits</dt><dd>One attempt. Expires in {APPROVAL_TTL_MS / 60000} minutes. No booking, holds or payments.</dd>
        </dl>
        <Note className="mt-4" tone={simulated ? "sim" : "held"} icon={simulated ? "file" : "phone"}>
          {simulated ? "Demo mode: this call is simulated. No phone will be dialed and the answers are a recorded script." : "Live: the backend will place one real call to this number after re-checking this approval."}
        </Note>
        <label className="mt-4 flex items-start gap-3 text-[14px]">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          I approve Mela calling {plan.phoneNumber} once, with exactly this script and these details.
        </label>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Edit first</Button>
          <Button icon="check" disabled={!ack} loading={busy === "approve" || busy === "call"} onClick={async () => { await approveAndCall("host"); setOpen(false); }}>Approve &amp; call once</Button>
        </div>
      </Dialog>
    </>
  );
}

const STEPS: { state: CallState; label: string }[] = [
  { state: "approved", label: "Approved" },
  { state: "dialing", label: "Dialing" },
  { state: "connected", label: "Connected" },
  { state: "completed", label: "Completed" },
];

function CallProgress({ attempt }: { attempt: CallAttempt }) {
  const { state, go } = useMela();
  const outcome = state.outcome;
  const order = ["preparing", "approved", "dialing", "connected", "completed"];
  const at = order.indexOf(attempt.state);
  const ended = ["completed", "declined", "failed", "not_contacted"].includes(attempt.state);
  const orb: OrbState = attempt.state === "failed" || attempt.state === "declined" ? "caution" : ended ? "succeeded" : attempt.state === "connected" ? "speaking" : "thinking";
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        {attempt.mode === "simulated" && (
          <Note tone="sim" icon="file" role="note"><span className="font-medium">Simulated call.</span> No phone was dialed. The vendor&apos;s answers are a recorded demo script.</Note>
        )}
        {attempt.mode === "role_play" && <Note tone="sim" icon="user" role="note"><span className="font-medium">Role-play.</span> A consenting teammate is playing a fictional venue.</Note>}
        <Card className="p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <MelaOrb state={orb} size={52} />
            <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-2 text-[13px]" aria-label="Call status">
              {STEPS.map((s, i) => {
                const done = at >= order.indexOf(s.state);
                const now = attempt.state === s.state;
                return (
                  <li key={s.state} className="flex items-center gap-1.5">
                    {i > 0 && <span aria-hidden className={`hidden h-px w-5 sm:block ${done ? "bg-primary/50" : "bg-line-strong"}`} />}
                    <span className={`rounded-full px-2.5 py-1 ${now ? "bg-primary font-medium text-white" : done ? "text-primary" : "text-faint"}`} aria-current={now ? "step" : undefined}>{s.label}</span>
                  </li>
                );
              })}
              {["declined", "failed", "not_contacted"].includes(attempt.state) && <li><Badge kind="exception">{attempt.state.replace("_", " ")}</Badge></li>}
            </ol>
          </div>
          <p className="sr-only" aria-live="polite">Call {attempt.state}</p>
          <SectionLabel className="mt-6">Transcript</SectionLabel>
          <div className="mt-2 max-h-[340px] space-y-2.5 overflow-y-auto rounded-xl bg-app p-3 text-[14px] leading-6">
            {attempt.transcript.length === 0 && <p className="text-faint">{attempt.state === "dialing" ? "Ringing…" : "No transcript."}</p>}
            {attempt.transcript.map((t, i) => (
              <p key={i} className="anim-rise"><span className={`mr-2 text-[12px] font-semibold ${t.speaker === "mela" ? "text-primary" : "text-research"}`}>{t.speaker === "mela" ? "Mela" : "Vendor"}</span>{t.text}</p>
            ))}
          </div>
          {attempt.failureReason && <p className="mt-2 text-[13px] text-warn">{attempt.failureReason}</p>}
        </Card>
      </div>
      <Card className="h-fit min-w-0 p-5 sm:p-6">
        <SectionLabel>What the vendor said</SectionLabel>
        {!outcome ? (
          <p className="t-small mt-2">{ended ? "No answers were recorded." : "Answers appear here as the call goes."}</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge kind="verbal">{outcome.availability === "vendor_said_verbally" ? "Date open, said verbally" : "Availability needs confirmation"}</Badge>
              <Badge kind="draft">Not booked</Badge>
              <Badge kind="draft">No written quote</Badge>
            </div>
            {outcome.price && <p className="mt-4 text-[15px]"><span className="font-medium">Verbal price: {usd(outcome.price.amountCents)}</span> <span className="text-est">· {outcome.price.note}</span></p>}
            <SectionLabel className="mt-5">Next for you</SectionLabel>
            <ul className="mt-1 space-y-1 text-[15px]">{outcome.followUps.map((f) => <li key={f} className="flex gap-2"><Icon name="arrow" size={14} className="mt-1.5 shrink-0 text-primary" />{f}</li>)}</ul>
            <Disclosure className="mt-5 !shadow-none !ring-0 bg-app" summary={`All ${outcome.answers.length} answers`} meta={`${outcome.answers.filter((a) => a.answer).length} answered`}>
              <ul className="space-y-3 text-[14px]">
                {outcome.answers.map((a) => (
                  <li key={a.question}>
                    <p className="text-muted">{a.question}</p>
                    <p className={a.answer ? "" : "text-unk"}>{a.answer ? `“${a.answer}”` : "Not answered"}</p>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </>
        )}
        {ended && (
          <div className="mt-5 flex flex-col gap-2 border-t border-line pt-5">
            <div className="flex flex-wrap gap-2">
              <Button iconRight="arrow" onClick={() => go("handoff")} aria-describedby="handoff-note">Hand off to Mela Events</Button>
              <Button variant="ghost" onClick={() => go("summary")}>See my summary</Button>
            </div>
            <p id="handoff-note" className="text-[12px] text-faint">Next: the planning business&apos;s finance workflow (simulated), separate from your planning.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
