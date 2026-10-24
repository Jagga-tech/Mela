"use client";
// P02–P03 Shape (Figma 93:79): what Mela understood, every field editable, priorities set by the host,
// one question at a time, research only after an explicit "Yes, start researching".
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { EventBrief, EventRequirement, RequirementPriority } from "../contracts";
import { confirmationBlockers, priorityLabel, removeRequirement, requirementFromLabel, scopeLabel, setRequirementPriority, editBrief } from "../domain/intake";
import { formatDate, usd } from "../domain/util";
import { useMela } from "../state/MelaProvider";
import { researchIsStale } from "../state/flow";
import { MelaOrb } from "../ui/MelaOrb";
import { Composer } from "../ui/Composer";
import { useVoice } from "../ui/useVoice";
import { Badge, Button, Card, Icon, SectionLabel } from "../ui/primitives";

export function ShapeScreen() {
  const { state, busy, startResearch, go } = useMela();
  const b = state.brief;
  const blockers = b ? confirmationBlockers(b) : [];
  const stale = researchIsStale(state);
  const firstField = useRef<HTMLButtonElement>(null);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <section aria-labelledby="brief-h" className="anim-rise">
        <SectionLabel>Event brief · built from your words</SectionLabel>
        <h1 id="brief-h" tabIndex={-1} className="mt-2 font-serif text-[34px] leading-[1.1] outline-none">
          {b ? headline(b) : "Tell Mela about your event"}
        </h1>
        <p className="mt-2 flex items-center gap-1.5 text-[13px] text-muted"><Icon name="edit" size={14} />Select any field to edit it. Priorities change what Mela searches for.</p>

        {!b && busy === "intake" && <div className="mt-6 grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[74px] rounded-xl" />)}</div>}
        {b && (
          <>
            <BriefFields brief={b} firstRef={firstField} />
            <Requirements brief={b} />
          </>
        )}

        {b && (
          <Card className="mt-6 p-5">
            {blockers.length > 0 ? (
              <div>
                <p className="text-[14px] font-medium">Before Mela researches anything:</p>
                <ul className="mt-2 space-y-1 text-[14px] text-muted">
                  {blockers.map((x) => <li key={x} className="flex gap-2"><Icon name="question" size={16} className="mt-0.5 shrink-0 text-unk" />{x}</li>)}
                </ul>
              </div>
            ) : (
              <p className="text-[14px] text-muted">
                {stale ? "You changed the brief after research ran. Re-run it so results match what you want now." : "This is everything Mela will search with. Nothing is contacted during research."}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" icon="edit" onClick={() => firstField.current?.click()}>Edit my details</Button>
              <Button size="lg" iconRight="arrow" disabled={blockers.length > 0} loading={busy === "research"} onClick={startResearch}>
                {stale ? "Re-run research with these changes" : "Yes, start researching"}
              </Button>
              {state.research && !stale && <Button variant="ghost" onClick={() => go("discover")}>See current results</Button>}
            </div>
          </Card>
        )}
      </section>
      <Conversation />
    </div>
  );
}

function headline(b: EventBrief) {
  const guests = b.guestRange ? (b.guestRange.min === b.guestRange.max ? `${b.guestRange.max}` : `${b.guestRange.min}–${b.guestRange.max}`) : null;
  const occ = b.occasion ? b.occasion.charAt(0).toUpperCase() + b.occasion.slice(1) : "An event";
  return `${occ}${guests ? ` for ${guests}` : ""}${b.city ? ` in ${b.city}` : ""}.`;
}

function FieldCard({ label, value, unset, children, buttonRef }: { label: string; value: ReactNode; unset?: boolean; children: (close: () => void) => ReactNode; buttonRef?: React.Ref<HTMLButtonElement> }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <div className="rounded-xl border-2 border-primary bg-surface p-3">
        <p className="label-mono">{label}</p>
        <div className="mt-1.5">{children(() => setEditing(false))}</div>
      </div>
    );
  return (
    <button ref={buttonRef} onClick={() => setEditing(true)} className={`group rounded-xl border p-3 text-left transition-colors hover:border-primary/50 ${unset ? "border-dashed border-faint/50 bg-transparent" : "border-line bg-surface"}`}>
      <p className="label-mono">{label}</p>
      <p className={`mt-1 text-[17px] ${unset ? "text-faint" : "font-medium"}`}>{value}</p>
      <span className="sr-only">Edit {label}</span>
    </button>
  );
}

function InlineForm({ initial, onSave, close, type = "text", placeholder }: { initial: string; onSave: (v: string) => void; close: () => void; type?: string; placeholder?: string }) {
  const [v, setV] = useState(initial);
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); onSave(v); close(); }}>
      <input autoFocus type={type} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Escape" && close()}
        className="min-w-0 flex-1 rounded-lg border border-line bg-app px-2.5 py-1.5 text-[15px]" />
      <Button size="sm" type="submit">Save</Button>
    </form>
  );
}

function BriefFields({ brief: b, firstRef }: { brief: EventBrief; firstRef: React.Ref<HTMLButtonElement> }) {
  const { setBrief } = useMela();
  const patch = (p: Partial<EventBrief>) => setBrief(editBrief(b, p));
  return (
    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FieldCard label="Occasion" value={b.occasion || "Not set"} unset={!b.occasion} buttonRef={firstRef}>
        {(close) => <InlineForm initial={b.occasion} close={close} onSave={(v) => patch({ occasion: v.trim().toLowerCase() })} />}
      </FieldCard>
      <FieldCard label="City" value={b.city || "Not set"} unset={!b.city}>
        {(close) => <InlineForm initial={b.city} close={close} onSave={(v) => patch({ city: v.trim() })} />}
      </FieldCard>
      <FieldCard label="Date" value={b.dateTarget ? formatDate(b.dateTarget) : "Not set"} unset={!b.dateTarget}>
        {(close) => <InlineForm type="date" initial={b.dateTarget ?? ""} close={close} onSave={(v) => patch({ dateTarget: v || null })} />}
      </FieldCard>
      <FieldCard label="Guests" value={b.guestRange ? (b.guestRange.min === b.guestRange.max ? `${b.guestRange.max} guests` : `${b.guestRange.min}–${b.guestRange.max} guests`) : "Not set"} unset={!b.guestRange}>
        {(close) => <GuestEditor brief={b} close={close} onSave={(r) => patch({ guestRange: r })} />}
      </FieldCard>
      <FieldCard label="Budget" value={b.budget.amountCents === null ? "Not set" : usd(b.budget.amountCents)} unset={b.budget.amountCents === null}>
        {(close) => <InlineForm type="number" initial={b.budget.amountCents === null ? "" : String(b.budget.amountCents / 100)} close={close}
          onSave={(v) => patch({ budget: { ...b.budget, amountCents: v === "" ? null : Math.max(0, Math.round(Number(v) * 100)) } })} />}
      </FieldCard>
      <FieldCard label="Budget covers" value={scopeLabel[b.budget.scope]} unset={b.budget.scope === "unset"}>
        {(close) => (
          <div className="flex flex-wrap gap-2">
            {(["venue_only", "all_in", "food_and_venue"] as const).map((s) => (
              <Button key={s} size="sm" variant={b.budget.scope === s ? "primary" : "secondary"} onClick={() => { patch({ budget: { ...b.budget, scope: s } }); close(); }}>{scopeLabel[s]}</Button>
            ))}
          </div>
        )}
      </FieldCard>
    </div>
  );
}

function GuestEditor({ brief, close, onSave }: { brief: EventBrief; close: () => void; onSave: (r: EventBrief["guestRange"]) => void }) {
  const [min, setMin] = useState(String(brief.guestRange?.min ?? ""));
  const [max, setMax] = useState(String(brief.guestRange?.max ?? ""));
  return (
    <form className="flex items-center gap-2" onSubmit={(e) => {
      e.preventDefault();
      const a = Number(min), z = Number(max || min);
      onSave(a > 0 && z > 0 ? { min: Math.min(a, z), max: Math.max(a, z) } : null);
      close();
    }}>
      <label className="sr-only" htmlFor="gmin">Fewest guests</label>
      <input id="gmin" autoFocus type="number" min={1} value={min} onChange={(e) => setMin(e.target.value)} className="w-20 rounded-lg border border-line bg-app px-2 py-1.5" />
      <span aria-hidden>–</span>
      <label className="sr-only" htmlFor="gmax">Most guests</label>
      <input id="gmax" type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} className="w-20 rounded-lg border border-line bg-app px-2 py-1.5" />
      <Button size="sm" type="submit">Save</Button>
    </form>
  );
}

const PRIORITIES: RequirementPriority[] = ["MUST_HAVE", "PREFERENCE", "FLEXIBLE"];

function Requirements({ brief: b }: { brief: EventBrief }) {
  const { setBrief } = useMela();
  const [adding, setAdding] = useState("");
  const groups: { title: string; items: EventRequirement[] }[] = [
    { title: "For the venue", items: b.requirements.filter((r) => r.appliesTo === "venue") },
    { title: "For the food", items: b.requirements.filter((r) => r.appliesTo === "catering") },
    { title: "For the event", items: b.requirements.filter((r) => r.appliesTo === "event") },
  ].filter((g) => g.items.length);
  return (
    <section aria-labelledby="req-h" className="mt-8">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="req-h" className="text-[18px] font-medium">What matters to you</h2>
        <p className="text-[12px] text-faint">Must-haves filter results. Preferences rank them.</p>
      </div>
      {groups.length === 0 && <p className="mt-3 text-[14px] text-muted">No specific needs yet. Add one below, or tell Mela in the chat.</p>}
      {groups.map((g) => (
        <div key={g.title} className="mt-4">
          <p className="label-mono mb-2">{g.title}</p>
          <ul className="space-y-2">
            {g.items.map((r) => (
              <li key={r.id} className={`anim-rise flex flex-wrap items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 ${r.priority === "UNSET" ? "border-dashed border-held/50" : "border-line"}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium">{r.label}</p>
                  {r.saidAs && <p className="truncate text-[12px] text-faint" title={r.saidAs}><Badge kind="yourWords">your words</Badge> “{r.saidAs}”</p>}
                </div>
                <fieldset className="flex rounded-lg border border-line p-0.5">
                  <legend className="sr-only">Priority for {r.label}</legend>
                  {PRIORITIES.map((p) => (
                    <label key={p} className={`cursor-pointer rounded-md px-2.5 py-1 text-[13px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${r.priority === p ? "bg-primary text-white" : "text-muted hover:bg-primary-soft"}`}>
                      <input type="radio" className="sr-only" name={`prio-${r.id}`} checked={r.priority === p} onChange={() => setBrief(setRequirementPriority(b, r.id, p))} />
                      {priorityLabel[p]}
                    </label>
                  ))}
                </fieldset>
                {r.key !== "capacity" && r.key !== "venue_budget" && (
                  <Button size="sm" variant="ghost" aria-label={`Remove ${r.label}`} onClick={() => setBrief(removeRequirement(b, r.id))}><Icon name="x" /></Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <form className="mt-3 flex gap-2" onSubmit={(e) => {
        e.preventDefault();
        if (!adding.trim()) return;
        const req = requirementFromLabel(adding.trim(), "UNSET");
        if (b.requirements.some((x) => x.id === req.id)) return setAdding("");
        setBrief(editBrief(b, { requirements: [...b.requirements, req] }));
        setAdding("");
      }}>
        <label htmlFor="add-req" className="sr-only">Add a requirement</label>
        <input id="add-req" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a need, e.g. “parking nearby”" className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-[14px]" />
        <Button variant="secondary" type="submit" icon="spark">Add</Button>
      </form>
    </section>
  );
}

function Conversation() {
  const { state, say, busy } = useMela();
  const [speakReplies, setSpeakReplies] = useState(false);
  const voice = useVoice(() => {});
  const end = useRef<HTMLDivElement>(null);
  const last = state.messages.at(-1);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [state.messages.length]);
  useEffect(() => {
    if (speakReplies && last?.from === "mela") void voice.speak(last.text);
  }, [last?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = state.questions[0];
  const orb = busy === "intake" ? "thinking" : voice.phase === "speaking" ? "speaking" : q ? "uncertain" : state.brief && !confirmationBlockers(state.brief).length ? "succeeded" : "idle";
  return (
    <section aria-labelledby="chat-h" className="anim-rise flex flex-col rounded-3xl border border-line bg-surface lg:sticky lg:top-24 lg:max-h-[calc(100vh-120px)]" style={{ animationDelay: "120ms" }}>
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        <MelaOrb state={orb} size={44} />
        <div className="flex-1">
          <h2 id="chat-h" className="font-medium">Talking with Mela</h2>
          <p className="text-[12px] text-faint">{state.intakeOrigin?.label ?? "Mela asks only what she needs"}</p>
        </div>
        {voice.engine === "cartesia" && (
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={speakReplies} onChange={(e) => { setSpeakReplies(e.target.checked); if (!e.target.checked) voice.interrupt(); }} />
            Mela speaks (Cartesia)
          </label>
        )}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4" aria-live="polite" aria-relevant="additions">
        {state.messages.map((m) => (
          <div key={m.id} className={`anim-rise flex ${m.from === "host" ? "justify-end" : "justify-start"}`}>
            <p className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-6 ${m.from === "host" ? "bg-primary text-white" : "bg-app"}`}>
              <span className="sr-only">{m.from === "host" ? "You said: " : "Mela said: "}</span>
              {m.text}
            </p>
          </div>
        ))}
        {busy === "intake" && <p className="text-[13px] text-faint" role="status">Mela is reading that…</p>}
        <div ref={end} />
      </div>
      <div className="border-t border-line p-4">
        {q?.options && (
          <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={q.question}>
            {q.options.map((o) => <Button key={o.value} variant="secondary" size="sm" onClick={() => say(o.label)} disabled={!!busy}>{o.label}</Button>)}
          </div>
        )}
        <Composer onSend={say} busy={busy === "intake"} placeholder={q ? q.question : "Add or change anything…"} />
      </div>
    </section>
  );
}
