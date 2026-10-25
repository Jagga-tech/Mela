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
import { ActionBar, Button, Card, Icon, PageHeader } from "../ui/primitives";

export function ShapeScreen() {
  const { state, busy, startResearch, go, say } = useMela();
  const b = state.brief;
  const blockers = b ? confirmationBlockers(b) : [];
  const stale = researchIsStale(state);
  const q = state.questions[0];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)] lg:gap-10">
      <section aria-labelledby="brief-h" className="anim-rise min-w-0 space-y-8">
        <PageHeader id="brief-h" eyebrow="Your brief · built from your words"
          title={b ? headline(b) : "Tell Mela about your event"}
          lede={b ? "Tap any detail to change it. Priorities decide what Mela filters and ranks." : undefined} />

        {!b && busy === "intake" && <div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[64px] rounded-xl" />)}</div>}
        {b && (
          <>
            <BriefFields brief={b} />
            <Requirements brief={b} />
          </>
        )}

        {b && (
          <ActionBar
            note={blockers.length > 0 ? (
              <div>
                <p className="font-medium text-fg">Before Mela researches anything</p>
                <ul className="mt-1 space-y-1">
                  {blockers.map((x) => <li key={x} className="flex gap-2"><Icon name="question" size={15} className="mt-0.5 shrink-0 text-held" />{x}</li>)}
                </ul>
                {q?.options && (
                  <div className="mt-3 flex flex-wrap gap-2 lg:hidden" role="group" aria-label={q.question}>
                    {q.options.map((o) => <Button key={o.value} variant="secondary" size="sm" onClick={() => say(o.label)} disabled={!!busy}>{o.label}</Button>)}
                  </div>
                )}
              </div>
            ) : stale ? "You changed the brief after research ran. Re-run it so results match what you want now."
              : "This is everything Mela will search with. Nothing is contacted during research."}>
            {state.research && !stale && <Button variant="ghost" onClick={() => go("discover")}>See current results</Button>}
            <Button size="lg" iconRight="arrow" disabled={blockers.length > 0} loading={busy === "research"} onClick={startResearch}>
              {stale ? "Re-run research" : "Yes, start researching"}
            </Button>
          </ActionBar>
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

function FieldCard({ label, value, unset, children }: { label: string; value: ReactNode; unset?: boolean; children: (close: () => void) => ReactNode }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <div className="rounded-xl bg-primary-soft/50 p-3 ring-2 ring-primary/60">
        <p className="label-mono">{label}</p>
        <div className="mt-1.5">{children(() => setEditing(false))}</div>
      </div>
    );
  return (
    <button onClick={() => setEditing(true)} className="group flex items-start justify-between gap-2 rounded-xl p-3 text-left transition-colors hover:bg-primary-soft/50">
      <span className="min-w-0">
        <span className="label-mono block">{label}</span>
        <span className={`mt-0.5 block text-[16px] ${unset ? "text-held" : "font-medium"}`}>{value}</span>
      </span>
      <Icon name="edit" size={14} className="mt-1 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      <span className="sr-only">Edit {label}</span>
    </button>
  );
}

function InlineForm({ initial, onSave, close, type = "text", placeholder }: { initial: string; onSave: (v: string) => void; close: () => void; type?: string; placeholder?: string }) {
  const [v, setV] = useState(initial);
  return (
    <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); onSave(v); close(); }}>
      <input autoFocus type={type} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Escape" && close()}
        className="min-w-0 flex-1 rounded-lg bg-surface px-2.5 py-1.5 text-[16px] ring-1 ring-line-strong" />
      <Button size="sm" type="submit">Save</Button>
    </form>
  );
}

function BriefFields({ brief: b }: { brief: EventBrief }) {
  const { setBrief } = useMela();
  const patch = (p: Partial<EventBrief>) => setBrief(editBrief(b, p));
  return (
    <Card className="grid grid-cols-2 gap-1 p-2 sm:grid-cols-3">
      <FieldCard label="Occasion" value={b.occasion || "Not set"} unset={!b.occasion}>
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
    </Card>
  );
}

function GuestEditor({ brief, close, onSave }: { brief: EventBrief; close: () => void; onSave: (r: EventBrief["guestRange"]) => void }) {
  const [min, setMin] = useState(String(brief.guestRange?.min ?? ""));
  const [max, setMax] = useState(String(brief.guestRange?.max ?? ""));
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
      e.preventDefault();
      const a = Number(min), z = Number(max || min);
      onSave(a > 0 && z > 0 ? { min: Math.min(a, z), max: Math.max(a, z) } : null);
      close();
    }}>
      <label className="sr-only" htmlFor="gmin">Fewest guests</label>
      <input id="gmin" autoFocus type="number" min={1} value={min} onChange={(e) => setMin(e.target.value)} className="w-16 rounded-lg bg-surface px-2 py-1.5 text-[16px] ring-1 ring-line-strong" />
      <span aria-hidden>–</span>
      <label className="sr-only" htmlFor="gmax">Most guests</label>
      <input id="gmax" type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} className="w-16 rounded-lg bg-surface px-2 py-1.5 text-[16px] ring-1 ring-line-strong" />
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
    <section aria-labelledby="req-h">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="req-h" className="text-[18px] font-medium">What matters to you</h2>
        <p className="t-small">Must-haves filter results. Preferences rank them.</p>
      </div>
      {groups.length === 0 && <p className="t-small mt-3">No specific needs yet. Add one below, or tell Mela in the chat.</p>}
      {groups.map((g) => (
        <div key={g.title} className="mt-5">
          <p className="label-mono mb-2 px-1">{g.title}</p>
          <Card as="div" className="divide-y divide-line">
            {g.items.map((r) => (
              <div key={r.id} className="anim-rise flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-[180px]">
                  <p className="text-[15px] font-medium">{r.label}</p>
                  {r.priority === "UNSET"
                    ? <p className="text-[13px] text-held">Choose a priority</p>
                    : r.saidAs && <p className="truncate text-[13px] text-faint" title={r.saidAs}>You said “{r.saidAs}”</p>}
                </div>
                <div className="flex items-center gap-1">
                  <fieldset className="flex rounded-full bg-subtle/70 p-0.5">
                    <legend className="sr-only">Priority for {r.label}</legend>
                    {PRIORITIES.map((p) => (
                      <label key={p} className={`cursor-pointer rounded-full px-2.5 py-1 text-[13px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${r.priority === p ? "bg-surface font-medium text-primary shadow-card" : "text-muted hover:text-fg"}`}>
                        <input type="radio" className="sr-only" name={`prio-${r.id}`} checked={r.priority === p} onChange={() => setBrief(setRequirementPriority(b, r.id, p))} />
                        {priorityLabel[p]}
                      </label>
                    ))}
                  </fieldset>
                  {r.key !== "capacity" && r.key !== "venue_budget" ? (
                    <Button size="sm" variant="ghost" className="!px-2" aria-label={`Remove ${r.label}`} onClick={() => setBrief(removeRequirement(b, r.id))}><Icon name="x" size={14} /></Button>
                  ) : <span className="w-8" aria-hidden />}
                </div>
              </div>
            ))}
          </Card>
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
        <input id="add-req" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a need, e.g. “parking nearby”" className="min-w-0 flex-1 rounded-full bg-surface px-4 py-2 text-[15px] ring-1 ring-line-strong placeholder:text-faint" />
        <Button variant="secondary" type="submit">Add</Button>
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
    <section aria-labelledby="chat-h" className="anim-rise flex min-w-0 flex-col rounded-3xl bg-surface shadow-card ring-1 ring-line lg:sticky lg:top-24 lg:max-h-[calc(100vh-120px)]" style={{ animationDelay: "120ms" }}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-4 sm:px-6">
        <MelaOrb state={orb} size={44} />
        <div className="min-w-0 flex-1">
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
      <div className="min-h-[260px] flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6" aria-live="polite" aria-relevant="additions">
        {state.messages.length === 0 && <p className="pt-6 text-center text-[14px] text-faint">Tell Mela about your event and she&apos;ll ask only what she needs.</p>}
        {state.messages.map((m) => (
          <div key={m.id} className={`anim-rise flex flex-col gap-1 ${m.from === "host" ? "items-end" : "items-start"}`}>
            <span className="px-1 text-[11px] font-medium uppercase tracking-wide text-faint" aria-hidden>{m.from === "host" ? "You" : "Mela"}</span>
            <p className={`max-w-[88%] whitespace-pre-wrap px-4 py-3 text-[15px] leading-[1.6] ${m.from === "host" ? "rounded-[20px] rounded-br-md bg-primary text-white" : "rounded-[20px] rounded-bl-md border border-line bg-app text-fg"}`}>
              <span className="sr-only">{m.from === "host" ? "You said: " : "Mela said: "}</span>
              {m.text}
            </p>
          </div>
        ))}
        {busy === "intake" && (
          <div className="flex items-center gap-2 px-1 text-[13px] text-faint" role="status">
            <span className="flex gap-1" aria-hidden>
              {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" style={{ animationDelay: `${d}ms` }} />)}
            </span>
            Mela is reading that…
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="border-t border-line px-4 pb-4 pt-4">
        {q?.options && (
          <div className="mb-3 flex flex-wrap gap-2 px-1" role="group" aria-label={q.question}>
            {q.options.map((o) => (
              <button key={o.value} type="button" onClick={() => say(o.label)} disabled={!!busy}
                className="rounded-full border border-line bg-surface px-4 py-2 text-[14px] text-fg transition-colors hover:border-primary/40 hover:bg-primary-soft disabled:cursor-not-allowed disabled:text-faint">
                {o.label}
              </button>
            ))}
          </div>
        )}
        <Composer onSend={say} busy={busy === "intake"} placeholder={q ? q.question : "Add or change anything…"} />
      </div>
    </section>
  );
}
