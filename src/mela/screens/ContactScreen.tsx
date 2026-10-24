"use client";
// P08 Consent (96:1543) adapted to the call gate: exact script, number source, shared vs private,
// one deliberate approval for one attempt, then honest call states and a verbal-only outcome.
import { useState } from "react";
import type { CallAttempt, CallState } from "../contracts";
import { APPROVAL_TTL_MS } from "../domain/calls";
import { formatTime, usd } from "../domain/util";
import { useMela } from "../state/MelaProvider";
import { MelaOrb, type OrbState } from "../ui/MelaOrb";
import { Badge, Button, Card, Dialog, Icon, SectionLabel } from "../ui/primitives";

export function ContactScreen() {
  const { state, go, dispatch, prepareCall, busy } = useMela();
  const plan = state.callPlan;
  const venue = state.research?.vendors.find((v) => v.id === state.selected.venue);

  if (!plan) {
    return (
      <div className="mx-auto max-w-[640px] space-y-4 pt-8 text-center">
        <MelaOrb state="idle" size={72} />
        <h1 tabIndex={-1} className="font-serif text-[32px] outline-none">Not contacted</h1>
        <p className="text-muted">{venue ? `${venue.name} has not been contacted. Nothing was sent or dialed.` : "Choose a venue first."}</p>
        <div className="flex justify-center gap-2">
          <Button variant="secondary" onClick={() => go("decide")}>Back to compare</Button>
          {venue && <Button onClick={prepareCall} loading={busy === "call_plan"}>Prepare a call plan</Button>}
          <Button variant="ghost" onClick={() => go("summary")}>See summary</Button>
        </div>
      </div>
    );
  }
  const started = !!state.attempt && state.attempt.callPlanId === plan.id;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionLabel>Call plan · v{plan.version} · {started ? "approved" : "draft, not approved"}</SectionLabel>
          <h1 tabIndex={-1} className="mt-1 font-serif text-[34px] leading-tight outline-none">{started ? `Calling ${plan.vendorName}` : "Nothing leaves Mela until you approve it"}</h1>
          <p className="mt-1 text-[14px] text-muted">{started ? "One attempt, exactly as approved." : `Here's exactly who Mela would call, what she'd say, and what she'd share about you.`}</p>
        </div>
        {plan.rolePlay && <Badge kind="rolePlay" title={plan.numberSource.label}>Role-play contact · consenting teammate</Badge>}
      </div>
      {started ? <CallProgress attempt={state.attempt!} /> : <PlanReview />}
      {!started && (
        <div className="bottom-4 z-20 sm:sticky flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 pl-4 shadow-lg backdrop-blur">
          <Icon name="lock" className="text-muted" />
          <p className="flex-1 text-[13px] text-muted">Your budget and contact details stay private. The approval covers this exact version only — any edit needs a new approval.</p>
          <Button variant="ghost" onClick={() => { dispatch({ type: "call_plan", plan: null }); dispatch({ type: "did", action: `Did not contact ${plan.vendorName} (you cancelled the plan)` }); }}>Don&apos;t call</Button>
          <ApproveButton />
        </div>
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-[13px]">
          <Icon name="phone" size={14} />
          <span className="font-mono">{plan.phoneNumber}</span>
          <span className="text-muted">· {plan.numberSource.label}</span>
        </div>
        <SectionLabel className="mt-5">Mela opens with</SectionLabel>
        <p className="mt-1 rounded-xl border-l-4 border-primary bg-primary-soft/60 px-4 py-3 text-[15px] leading-6">“{plan.disclosure} {plan.opening}”</p>
        <div className="mt-5 flex items-center justify-between">
          <SectionLabel>Questions Mela will ask · and nothing else</SectionLabel>
          {!editing && <Button size="sm" variant="ghost" icon="edit" onClick={() => { setDraft(plan.questions); setEditing(true); }}>Edit</Button>}
        </div>
        {editing ? (
          <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); editCallPlan({ questions: draft.map((q) => q.trim()).filter(Boolean) }); setEditing(false); }}>
            {draft.map((q, i) => (
              <div key={i} className="flex gap-2">
                <label className="sr-only" htmlFor={`q-${i}`}>Question {i + 1}</label>
                <textarea id={`q-${i}`} rows={2} value={q} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? e.target.value : x)))} className="flex-1 rounded-lg border border-line bg-app px-3 py-2 text-[14px]" />
                <Button type="button" size="sm" variant="ghost" aria-label={`Remove question ${i + 1}`} onClick={() => setDraft(draft.filter((_, j) => j !== i))}><Icon name="x" /></Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => setDraft([...draft, ""])}>Add question</Button>
              <Button type="submit" size="sm">Save as v{plan.version + 1}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[15px]">{plan.questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
        )}
        <SectionLabel className="mt-5">Mela will not agree to</SectionLabel>
        <ul className="mt-1 space-y-1 text-[14px] text-muted">{plan.mustNotAgreeTo.map((m) => <li key={m} className="flex gap-2"><Icon name="x" size={14} className="mt-1 text-warn" />{m}</li>)}</ul>
      </Card>
      <Card className="h-fit p-5">
        <SectionLabel>What will be shared</SectionLabel>
        <ul className="mt-3 space-y-2">
          {plan.sharedDetails.map((d) => (
            <li key={d.key} className="flex items-center justify-between rounded-lg bg-primary-soft px-3 py-2 text-[14px]">
              <span className="flex items-center gap-2"><Icon name="check" size={14} />{d.label}: <strong>{d.value}</strong></span>
              <span className="text-[12px] text-primary">Shared</span>
            </li>
          ))}
          {plan.privateDetails.map((d) => (
            <li key={d} className="flex items-center justify-between rounded-lg bg-subtle px-3 py-2 text-[14px] text-muted">
              <span className="flex items-center gap-2"><Icon name="lock" size={14} />{d}</span>
              <span className="text-[12px]">Private</span>
            </li>
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
        <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-y-2 text-[14px]">
          <dt className="text-muted">Who</dt><dd className="font-medium">{plan.vendorName}{plan.rolePlay && " (role-played by a consenting teammate)"}</dd>
          <dt className="text-muted">Number</dt><dd className="font-mono">{plan.phoneNumber}</dd>
          <dt className="text-muted">Script</dt><dd>v{plan.version} · {plan.questions.length} questions · <span className="font-mono">{plan.scriptHash}</span></dd>
          <dt className="text-muted">Shares</dt><dd>{plan.sharedDetails.map((d) => d.label).join(", ")}</dd>
          <dt className="text-muted">Limits</dt><dd>One attempt. Expires in {APPROVAL_TTL_MS / 60000} minutes. No booking, holds or payments.</dd>
        </dl>
        <div className={`mt-4 rounded-xl px-4 py-3 text-[13px] ${simulated ? "bg-sim-soft text-sim" : "bg-held-soft text-held"}`}>
          {simulated ? "Demo mode: this call is simulated. No phone will be dialed and the answers are a recorded script." : "Live: the backend will place one real call to this number after re-checking this approval."}
        </div>
        <label className="mt-4 flex items-start gap-3 text-[14px]">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          I approve Mela calling {plan.phoneNumber} once, with exactly this script and these details.
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="secondary" icon="edit" onClick={() => setOpen(false)}>Edit first</Button>
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Card className="p-5">
        {attempt.mode === "simulated" && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-sim-soft px-3 py-2 text-[13px] font-medium text-sim" role="note">
            <Icon name="file" size={14} />SIMULATED CALL — no phone was dialed. The vendor&apos;s answers are a recorded demo script.
          </div>
        )}
        {attempt.mode === "role_play" && <div className="mb-4 rounded-xl bg-sim-soft px-3 py-2 text-[13px] font-medium text-sim">ROLE-PLAY — a consenting teammate is playing a fictional venue.</div>}
        <div className="flex items-center gap-4">
          <MelaOrb state={orb} size={64} />
          <ol className="flex flex-1 flex-wrap items-center gap-2 text-[13px]" aria-label="Call status">
            {STEPS.map((s, i) => {
              const done = at >= order.indexOf(s.state);
              return (
                <li key={s.state} className="flex items-center gap-2">
                  {i > 0 && <span className={`h-px w-5 ${done ? "bg-primary" : "bg-line"}`} />}
                  <span className={`rounded-full px-2.5 py-1 ${attempt.state === s.state ? "bg-primary text-white" : done ? "bg-primary-soft text-primary" : "bg-subtle text-faint"}`} aria-current={attempt.state === s.state ? "step" : undefined}>{s.label}</span>
                </li>
              );
            })}
            {["declined", "failed", "not_contacted"].includes(attempt.state) && <li><Badge kind="exception">{attempt.state.replace("_", " ")}</Badge></li>}
          </ol>
        </div>
        <p className="sr-only" aria-live="polite">Call {attempt.state}</p>
        <SectionLabel className="mt-5">Transcript</SectionLabel>
        <div className="mt-2 max-h-[360px] space-y-2 overflow-y-auto rounded-xl bg-app p-3 text-[14px]">
          {attempt.transcript.length === 0 && <p className="text-faint">{attempt.state === "dialing" ? "Ringing…" : "No transcript."}</p>}
          {attempt.transcript.map((t, i) => (
            <p key={i} className="anim-rise"><span className={`mr-2 font-mono text-[11px] uppercase ${t.speaker === "mela" ? "text-primary" : "text-research"}`}>{t.speaker === "mela" ? "Mela" : "Vendor"}</span>{t.text}</p>
          ))}
        </div>
        {attempt.failureReason && <p className="mt-2 text-[13px] text-warn">{attempt.failureReason}</p>}
      </Card>
      <Card className="h-fit p-5">
        <SectionLabel>What the vendor said</SectionLabel>
        {!outcome ? (
          <p className="mt-2 text-[14px] text-muted">{ended ? "No answers were recorded." : "Answers appear here as the call goes."}</p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge kind="verbal">{outcome.availability === "vendor_said_verbally" ? "Date open — vendor said verbally" : "Availability needs confirmation"}</Badge>
              <Badge kind="draft">Not booked</Badge>
              <Badge kind="draft">No written quote</Badge>
            </div>
            <ul className="mt-3 space-y-2 text-[14px]">
              {outcome.answers.map((a) => (
                <li key={a.question}>
                  <p className="text-muted">{a.question}</p>
                  <p className={a.answer ? "" : "text-unk"}>{a.answer ? `“${a.answer}”` : "Not answered"}</p>
                </li>
              ))}
            </ul>
            {outcome.price && <p className="mt-3 rounded-lg bg-est-soft px-3 py-2 text-[13px] text-est">Verbal price: {usd(outcome.price.amountCents)} — {outcome.price.note}</p>}
            <SectionLabel className="mt-4">Next for you</SectionLabel>
            <ul className="mt-1 space-y-1 text-[14px]">{outcome.followUps.map((f) => <li key={f} className="flex gap-2"><Icon name="arrow" size={14} className="mt-1" />{f}</li>)}</ul>
          </>
        )}
        {ended && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => go("summary")}>See my summary</Button>
            <Button iconRight="arrow" onClick={() => go("handoff")} aria-describedby="handoff-note">Hand off to Mela Events</Button>
            <p id="handoff-note" className="w-full text-[12px] text-faint">Next: the planning business&apos;s finance workflow (simulated). Separate from your planning.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
