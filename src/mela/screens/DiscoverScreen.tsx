"use client";
// P04 Researching (94:433) + P05 Discover (94:705) + P07 Evidence drawer (95:1625).
import { useState } from "react";
import type { Recommendation, RequirementCheck, ResearchSource, Vendor, VendorCategory } from "../contracts";
import { priceTypeLabel } from "../domain/match";
import { formatTime } from "../domain/util";
import { useMela } from "../state/MelaProvider";
import { useRecommendations } from "../state/derived";
import { researchIsStale } from "../state/flow";
import { MelaOrb } from "../ui/MelaOrb";
import { Badge, Button, Card, Dialog, Icon, SectionLabel, type BadgeKind, type IconName } from "../ui/primitives";

const STATUS: Record<ResearchSource["status"], { label: string; cls: string; icon: IconName }> = {
  queued: { label: "Queued", cls: "text-faint", icon: "dot" },
  searching: { label: "Searching", cls: "text-research", icon: "spinner" },
  fetching: { label: "Reading", cls: "text-research", icon: "spinner" },
  extracting: { label: "Extracting", cls: "text-research", icon: "spinner" },
  slow: { label: "Slow — still trying", cls: "text-est", icon: "spinner" },
  found: { label: "Done", cls: "text-ok", icon: "check" },
  partial: { label: "Partial", cls: "text-est", icon: "alert" },
  empty: { label: "Nothing found", cls: "text-unk", icon: "dot" },
  blocked: { label: "Blocked", cls: "text-warn", icon: "x" },
  error: { label: "Failed", cls: "text-warn", icon: "x" },
};

export function DiscoverScreen() {
  const { state, cancelResearch, go, busy } = useMela();
  const job = state.research?.job;
  const [tab, setTab] = useState<VendorCategory>("venue");
  if (!job) return null;
  const running = job.status === "running";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 tabIndex={-1} className="font-serif text-[34px] leading-tight outline-none">{running ? "Checking sources for you" : "Here's what Mela found"}</h1>
          <p className="mt-1 max-w-[720px] text-[14px] text-muted">
            Facts come from vendors&apos; own pages. Reviews and posts never prove price, policy or availability. Unknowns stay unknown until someone confirms them.
          </p>
        </div>
        <Badge kind={job.origin.mode === "live" ? "live" : "fixture"} title={job.origin.label}>{job.origin.label}</Badge>
      </div>
      {researchIsStale(state) && (
        <div className="flex items-center gap-3 rounded-xl border border-est/30 bg-est-soft px-4 py-3 text-[14px] text-est">
          <Icon name="alert" />These results are for an earlier version of your brief.
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => go("shape")}>Review &amp; re-run</Button>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside aria-labelledby="src-h" className="space-y-3">
          <h2 id="src-h" className="sr-only">Sources</h2>
          <SourceList sources={job.sources} />
          {running && <Button variant="secondary" icon="x" onClick={cancelResearch} loading={busy === "research"}>Stop researching</Button>}
          {job.status === "cancelled" && <p className="text-[13px] text-muted">You stopped the research. Results so far are kept; nothing else was fetched.</p>}
          <BriefRecap />
        </aside>
        <section aria-labelledby="results-h">
          <h2 id="results-h" className="sr-only">Results</h2>
          <div role="tablist" aria-label="Category" className="mb-4 inline-flex rounded-xl bg-subtle p-1">
            {(["venue", "catering"] as const).map((c) => <TabButton key={c} category={c} current={tab} onSelect={setTab} />)}
          </div>
          <CategoryResults category={tab} running={running} />
        </section>
      </div>
      <SelectionBar />
    </div>
  );
}

function TabButton({ category, current, onSelect }: { category: VendorCategory; current: VendorCategory; onSelect: (c: VendorCategory) => void }) {
  const { [category]: view } = useRecommendations();
  const fit = view.list.top.length;
  return (
    <button role="tab" aria-selected={current === category} onClick={() => onSelect(category)}
      className={`rounded-lg px-4 py-1.5 text-[14px] ${current === category ? "bg-surface font-medium shadow-sm" : "text-muted"}`}>
      {category === "venue" ? "Venues" : "Caterers"} · {fit} {fit === 1 ? "option" : "options"}
    </button>
  );
}

function SourceList({ sources }: { sources: ResearchSource[] }) {
  const done = sources.filter((s) => ["found", "partial", "empty", "blocked", "error"].includes(s.status)).length;
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel>Sources · {done} of {sources.length} settled</SectionLabel>
      </div>
      <ul className="space-y-2.5" aria-live="polite">
        {sources.map((s) => {
          const st = STATUS[s.status];
          return (
            <li key={s.id} className="flex items-start gap-2.5 text-[13px]">
              <span className={`mt-0.5 ${st.cls}`}><Icon name={st.icon} size={15} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" title={s.url}>{s.label}</p>
                <p className="text-faint">
                  {s.error ?? (s.fetchedAt ? `Checked ${formatTime(s.fetchedAt)}` : s.status === "queued" ? "Waiting" : "In progress")}
                </p>
              </div>
              <span className={`font-mono text-[10px] uppercase tracking-wider ${st.cls}`}>{st.label}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function BriefRecap() {
  const { state, go } = useMela();
  const b = state.brief;
  if (!b) return null;
  const must = b.requirements.filter((r) => r.priority === "MUST_HAVE").map((r) => r.label);
  return (
    <div className="rounded-xl bg-subtle p-4 text-[13px]">
      <SectionLabel>Using your brief</SectionLabel>
      <p className="mt-1.5 text-muted">Must-haves: {must.join(" · ") || "none"}</p>
      <button className="mt-2 text-[13px] text-primary underline underline-offset-2" onClick={() => go("shape")}>Edit brief</button>
    </div>
  );
}

function CategoryResults({ category, running }: { category: VendorCategory; running: boolean }) {
  const { [category]: view, vendorsById } = useRecommendations();
  const { list } = view;
  const noun = category === "venue" ? "venue" : "caterer";
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.top.map((r, i) => <VendorCard key={r.vendorId} rec={r} vendor={vendorsById.get(r.vendorId)!} delay={i * 60} />)}
        {running && Array.from({ length: Math.max(0, 3 - list.top.length) }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-dashed border-line p-4" aria-hidden>
            <div className="skeleton h-28 rounded-xl" />
            <div className="skeleton mt-4 h-4 w-2/3 rounded" />
            <div className="skeleton mt-2 h-3 w-full rounded" />
          </div>
        ))}
      </div>
      {!running && list.top.length === 0 && (
        <Card className="flex items-center gap-4 p-6">
          <MelaOrb state="uncertain" size={56} />
          <div>
            <p className="font-medium">No {noun} meets every must-have from these sources.</p>
            <p className="text-[14px] text-muted">That&apos;s an honest result, not a failure. Try relaxing one must-have in your brief, or check the excluded options below.</p>
          </div>
        </Card>
      )}
      {list.more.length > 0 && <p className="text-[13px] text-muted">{list.more.length} more possible {noun}{list.more.length > 1 ? "s" : ""} not shown — Mela starts with three.</p>}
      {list.excluded.length > 0 && (
        <details className="rounded-xl border border-line bg-surface/60 p-4">
          <summary className="cursor-pointer text-[14px] font-medium">Didn&apos;t make it · {list.excluded.length} known must-have conflict{list.excluded.length > 1 ? "s" : ""}</summary>
          <ul className="mt-3 space-y-2">
            {list.excluded.map((r) => {
              const v = vendorsById.get(r.vendorId)!;
              const why = r.checks.filter((c) => c.priority === "MUST_HAVE" && c.result === "violates");
              return (
                <li key={r.vendorId} className="flex flex-wrap items-center gap-2 text-[14px]">
                  <Badge kind="excluded">Fails a must-have</Badge>
                  <span className="font-medium">{v.name}</span>
                  <span className="text-muted">— {why.map((c) => `${c.label}: ${c.note}`).join("; ")}</span>
                  <EvidenceButton vendor={v} rec={r} small />
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {list.unchecked.length > 0 && (
        <div className="rounded-xl border border-dashed border-line p-4 text-[14px]">
          <p className="font-medium">Couldn&apos;t check</p>
          {list.unchecked.map((r) => {
            const v = vendorsById.get(r.vendorId)!;
            return <p key={r.vendorId} className="text-muted">{v.name} — its page blocked automated reading. {v.website && <a className="text-primary underline" href={v.website} target="_blank" rel="noreferrer">Open it yourself</a>}</p>;
          })}
        </div>
      )}
    </div>
  );
}

const LABEL_TEXT = { best_fit: "Best fit", lowest_published_estimate: "Lowest published estimate", best_tradeoff: "Best trade-off" } as const;

export function priceBadge(t: Recommendation["price"]["priceType"]): BadgeKind {
  return t === "published" ? "verified" : t === "estimated" ? "estimated" : t === "verbal" ? "verbal" : t === "simulated" ? "simulated" : "unknown";
}

export function CheckRow({ c }: { c: RequirementCheck }) {
  const map = { meets: ["check", "text-ok"], violates: ["x", "text-warn"], unknown: ["question", "text-unk"], conflicting: ["alert", "text-held"], not_applicable: ["dot", "text-faint"] } as const;
  const [icon, cls] = map[c.result];
  const word = { meets: "meets", violates: "does not meet", unknown: "unknown", conflicting: "sources disagree", not_applicable: "flexible" }[c.result];
  return (
    <li className="flex gap-2 text-[13px] leading-5">
      <span className={`mt-0.5 ${cls}`}><Icon name={icon} size={14} label={word} /></span>
      <span><span className="font-medium">{c.label}</span>{c.priority === "MUST_HAVE" && <span className="text-faint"> · must</span>}<span className="text-muted"> — {c.note}</span></span>
    </li>
  );
}

function VendorArt({ vendor }: { vendor: Vendor }) {
  const [a, b] = vendor.palette ?? ["#e9e1f3", "#f3e6d8"];
  return (
    <div className="relative h-28 overflow-hidden rounded-t-2xl" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
      <svg aria-hidden viewBox="0 0 200 80" className="absolute inset-0 h-full w-full opacity-40" preserveAspectRatio="none">
        {vendor.category === "venue"
          ? <path d="M20 70V35l40-20 40 20v35M110 70V25h70v45M130 40h10M155 40h10M130 55h10M155 55h10" fill="none" stroke="#fff" strokeWidth="2.5" />
          : <g fill="none" stroke="#fff" strokeWidth="2.5"><ellipse cx="60" cy="55" rx="40" ry="10" /><path d="M30 50q30-30 60 0" /><circle cx="150" cy="45" r="18" /><path d="M150 27v-8" /></g>}
      </svg>
      <span className="absolute left-3 top-3"><Badge kind={vendor.fictional ? "fixture" : "info"}>{vendor.fictional ? "Fictional demo vendor · no photo" : "No permitted photo"}</Badge></span>
    </div>
  );
}

function VendorCard({ rec, vendor, delay }: { rec: Recommendation; vendor: Vendor; delay: number }) {
  const { state, select } = useMela();
  const selected = state.selected[vendor.category] === vendor.id;
  const checks = [...rec.checks].filter((c) => c.result !== "not_applicable").sort((a, b) => (a.priority === "MUST_HAVE" ? 0 : 1) - (b.priority === "MUST_HAVE" ? 0 : 1));
  const review = state.research?.reviews.find((r) => r.vendorId === vendor.id && r.excerpt);
  return (
    <article className={`anim-rise flex flex-col rounded-2xl border bg-surface transition-shadow ${selected ? "border-primary shadow-[0_0_0_2px_var(--mela-action-primary)]" : "border-line"}`} style={{ animationDelay: `${delay}ms` }} aria-label={vendor.name}>
      <VendorArt vendor={vendor} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap gap-1.5">
          {rec.labels.map((l) => <Badge key={l} kind="approved">{LABEL_TEXT[l]}</Badge>)}
          {rec.matchStatus === "verified_match" ? <Badge kind="verified">Meets every must-have</Badge> : <Badge kind="unknown">Possible — needs confirmation</Badge>}
        </div>
        <h3 className="mt-2 text-[19px] font-medium">{vendor.name}</h3>
        <p className="text-[13px] text-muted">{vendor.area}</p>
        <ul className="mt-3 space-y-1.5">{checks.slice(0, 5).map((c) => <CheckRow key={c.requirementId} c={c} />)}</ul>
        {checks.length > 5 && <p className="mt-1 text-[12px] text-faint">+{checks.length - 5} more in evidence</p>}
        {review && (
          <blockquote className="mt-3 rounded-lg bg-research-soft/60 px-3 py-2 text-[12px] text-research">
            “{review.excerpt}” <span className="block text-[11px] opacity-80">{review.attribution} · {review.sampleContext} · opinion, not policy</span>
          </blockquote>
        )}
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-subtle px-3 py-2">
          <span className="font-mono text-[13px]">{rec.price.note}</span>
          <Badge kind={priceBadge(rec.price.priceType)}>{priceTypeLabel[rec.price.priceType]}</Badge>
        </div>
        <div className="mt-auto flex gap-2 pt-4">
          <Button className="flex-1" variant={selected ? "secondary" : "primary"} icon={selected ? "check" : undefined} aria-pressed={selected} aria-label={`${selected ? "Chosen" : "Choose"} ${vendor.name}`}
            onClick={() => select(vendor.category, selected ? null : vendor.id)}>
            {selected ? "Chosen" : "Choose"}
          </Button>
          <EvidenceButton vendor={vendor} rec={rec} />
        </div>
      </div>
    </article>
  );
}

export function EvidenceButton({ vendor, rec, small }: { vendor: Vendor; rec: Recommendation; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const { state } = useMela();
  const facts = state.research?.facts.filter((f) => f.vendorId === vendor.id) ?? [];
  const reviews = state.research?.reviews.filter((r) => r.vendorId === vendor.id) ?? [];
  const id = `ev-${vendor.id}`;
  return (
    <>
      <Button size={small ? "sm" : "md"} variant="secondary" icon="globe" onClick={() => setOpen(true)}>{small ? "Evidence" : `${facts.length} facts`}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`${vendor.name} — evidence`} labelledBy={id} wide>
        <p className="text-[13px] text-muted">{vendor.fictional ? "Fictional demo vendor. These are recorded fixture facts, not a live read." : "Retrieved from public pages."} Every fact links to where it came from.</p>
        <h3 className="mt-5 text-[15px] font-medium">How it matches your brief</h3>
        <ul className="mt-2 space-y-1.5">{rec.checks.map((c) => <CheckRow key={c.requirementId} c={c} />)}</ul>
        <h3 className="mt-6 text-[15px] font-medium">Source facts</h3>
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
          {facts.map((f) => (
            <li key={f.id} className="grid gap-1 p-3 text-[13px] sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
              <span className="font-mono text-[12px] text-muted">{f.field.replace(/_/g, " ")}</span>
              <span>{f.state === "verified" ? <>“{f.quote}”{f.qualifier && f.qualifier !== "exact" && <Badge kind="estimated">{f.qualifier.replace("_", " ")}</Badge>}</> : <span className="text-unk">Unknown — {f.unknownReason?.replace(/_/g, " ")}</span>}</span>
              <span className="flex items-center gap-2 text-[12px] text-faint">
                {formatTime(f.retrievedAt)}
                {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="text-primary" aria-label={`Open source for ${f.field}`}><Icon name="external" size={14} /></a>}
              </span>
            </li>
          ))}
        </ul>
        {reviews.length > 0 && (
          <>
            <h3 className="mt-6 text-[15px] font-medium">Public reviews <span className="font-normal text-faint">(opinions — never treated as policy)</span></h3>
            <ul className="mt-2 space-y-2">
              {reviews.map((r) => (
                <li key={r.id} className="rounded-xl bg-research-soft/50 p-3 text-[13px]">
                  <p>“{r.excerpt}” {r.rating !== undefined && <span className="text-faint">· {r.rating}/5</span>}</p>
                  <p className="mt-1 text-[12px] text-faint">{r.attribution} · {r.sampleContext} · retrieved {formatTime(r.retrievedAt)}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Dialog>
    </>
  );
}

function SelectionBar() {
  const { state, go } = useMela();
  const { vendorsById } = useRecommendations();
  const v = state.selected.venue && vendorsById.get(state.selected.venue);
  const c = state.selected.catering && vendorsById.get(state.selected.catering);
  const done = state.research?.job.status !== "running";
  return (
    <div className="bottom-4 z-20 sm:sticky flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 pl-4 shadow-lg backdrop-blur">
      <MelaOrb state={v ? "succeeded" : "idle"} size={36} decorative />
      <p className="flex-1 text-[14px]">
        {v || c ? <>Chosen: <strong>{v ? v.name : "no venue yet"}</strong> · <strong>{c ? c.name : "no caterer yet"}</strong>. Choosing doesn&apos;t book, pay or contact anyone.</> : "Choose a venue and a caterer you like — choosing doesn't contact anyone."}
      </p>
      <Button iconRight="arrow" disabled={!done} onClick={() => go("decide")}>Compare &amp; decide</Button>
    </div>
  );
}
