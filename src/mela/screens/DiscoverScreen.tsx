"use client";
// P04 Researching (94:433) + P05 Discover (94:705) + P07 Evidence drawer (95:1625).
// Layout: header → compact research summary (expandable per-source list) → category tabs →
// up to three calm cards → excluded / couldn't-check lists (collapsed but always present).
import { useState } from "react";
import type { VendorCategory } from "../contracts";
import { useMela } from "../state/MelaProvider";
import { useRecommendations } from "../state/derived";
import { researchIsStale } from "../state/flow";
import { MelaOrb } from "../ui/MelaOrb";
import { Badge, Button, Icon } from "../ui/primitives";
import { DisclosureSummary, RESULT } from "../ui/discover/bits";
import { EvidenceButton } from "../ui/discover/Evidence";
import { ResearchSummary } from "../ui/discover/ResearchSummary";
import { VendorCard } from "../ui/discover/VendorCard";

// Re-exported so existing imports keep working.
export { CheckRow, priceBadge } from "../ui/discover/bits";
export { EvidenceButton } from "../ui/discover/Evidence";

export function DiscoverScreen() {
  const { state, cancelResearch, go, busy } = useMela();
  const job = state.research?.job;
  const [tab, setTab] = useState<VendorCategory>("venue");
  if (!job) return null;
  const running = job.status === "running";
  return (
    <div className="space-y-6 pb-4">
      <header className="space-y-3">
        <h1 tabIndex={-1} className="font-serif text-[30px] leading-tight outline-none sm:text-[34px]">{running ? "Checking sources for you" : "Here's what Mela found"}</h1>
        <p className="max-w-[640px] text-[15px] text-muted">Facts come from vendors&apos; own pages. Anything a page doesn&apos;t say stays unknown until someone confirms it.</p>
        <Badge kind={job.origin.mode === "live" ? "live" : "fixture"} title={job.origin.label}>
          <span className="whitespace-normal">{job.origin.label}</span>
        </Badge>
      </header>

      {researchIsStale(state) && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-est/30 bg-est-soft px-4 py-3 text-[14px] text-est">
          <Icon name="alert" /><span className="flex-1">These results are for an earlier version of your brief.</span>
          <Button size="sm" variant="secondary" onClick={() => go("shape")}>Review &amp; re-run</Button>
        </div>
      )}

      <ResearchSummary job={job} onStop={cancelResearch} stopping={busy === "research"} />

      <section aria-labelledby="results-h" className="space-y-5">
        <h2 id="results-h" className="sr-only">Results</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Category" className="inline-flex rounded-xl bg-subtle p-1">
            {(["venue", "catering"] as const).map((c) => <TabButton key={c} category={c} current={tab} onSelect={setTab} />)}
          </div>
          <BriefRecap />
        </div>
        <div role="tabpanel" aria-label={tab === "venue" ? "Venues" : "Caterers"}>
          <CategoryResults category={tab} running={running} />
        </div>
      </section>
      <SelectionBar />
    </div>
  );
}

function TabButton({ category, current, onSelect }: { category: VendorCategory; current: VendorCategory; onSelect: (c: VendorCategory) => void }) {
  const { [category]: view } = useRecommendations();
  const fit = view.list.top.length;
  return (
    <button role="tab" aria-selected={current === category} onClick={() => onSelect(category)}
      className={`rounded-lg px-4 py-1.5 text-[14px] ${current === category ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-fg"}`}>
      {category === "venue" ? "Venues" : "Caterers"} <span className="text-faint">{fit}</span>
    </button>
  );
}

function BriefRecap() {
  const { state, go } = useMela();
  const b = state.brief;
  if (!b) return null;
  const must = b.requirements.filter((r) => r.priority === "MUST_HAVE").length;
  return (
    <p className="text-[13px] text-muted">
      Matched against your {must} must-have{must === 1 ? "" : "s"} ·{" "}
      <button className="text-primary underline underline-offset-2" onClick={() => go("shape")}>Edit brief</button>
    </p>
  );
}

function CategoryResults({ category, running }: { category: VendorCategory; running: boolean }) {
  const { [category]: view, vendorsById } = useRecommendations();
  const { list } = view;
  const noun = category === "venue" ? "venue" : "caterer";
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.top.map((r, i) => <VendorCard key={r.vendorId} rec={r} vendor={vendorsById.get(r.vendorId)!} delay={i * 60} />)}
        {running && Array.from({ length: Math.max(0, 3 - list.top.length) }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-dashed border-line p-5" aria-hidden>
            <div className="flex gap-3"><div className="skeleton h-10 w-10 rounded-xl" /><div className="skeleton h-5 flex-1 rounded" /></div>
            <div className="skeleton mt-5 h-3 w-2/3 rounded" />
            <div className="skeleton mt-2 h-3 w-full rounded" />
            <div className="skeleton mt-6 h-4 w-1/2 rounded" />
          </div>
        ))}
      </div>

      {!running && list.top.length === 0 && (
        <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-5">
          <MelaOrb state="uncertain" size={48} />
          <div>
            <p className="font-medium">No {noun} meets every must-have from these sources.</p>
            <p className="text-[14px] text-muted">That&apos;s an honest result, not a failure. Relax one must-have in your brief, or see why options were left out below.</p>
          </div>
        </div>
      )}

      {list.more.length > 0 && <p className="text-[13px] text-muted">{list.more.length} more possible {noun}{list.more.length > 1 ? "s" : ""} not shown — Mela starts with three.</p>}

      {(list.excluded.length > 0 || list.unchecked.length > 0) && (
        <div className="divide-y divide-line rounded-2xl border border-line bg-surface/60">
          {list.excluded.length > 0 && (
            <details className="p-4">
              <DisclosureSummary className="text-fg">
                Left out · {list.excluded.length} {noun}{list.excluded.length > 1 ? "s" : ""} fail{list.excluded.length > 1 ? "" : "s"} a must-have
              </DisclosureSummary>
              <ul className="mt-3 space-y-3">
                {list.excluded.map((r) => {
                  const v = vendorsById.get(r.vendorId)!;
                  const why = r.checks.filter((c) => c.priority === "MUST_HAVE" && c.result === "violates");
                  return (
                    <li key={r.vendorId} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-[14px]">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{v.name}{v.fictional && <span className="ml-2 text-[12px] font-normal text-sim">Fictional demo vendor</span>}</p>
                        <ul className="mt-0.5 space-y-0.5 text-[13px] text-muted">
                          {why.map((c) => (
                            <li key={c.requirementId} className="flex gap-1.5">
                              <span className={`mt-0.5 ${RESULT.violates.cls}`}><Icon name="x" size={13} label="does not meet" /></span>
                              <span>{c.label}: {c.note}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <EvidenceButton vendor={v} rec={r} small />
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
          {list.unchecked.length > 0 && (
            <details className="p-4">
              <DisclosureSummary className="text-fg">Couldn&apos;t check · {list.unchecked.length} {noun}{list.unchecked.length > 1 ? "s" : ""}</DisclosureSummary>
              <ul className="mt-3 space-y-1.5 text-[14px]">
                {list.unchecked.map((r) => {
                  const v = vendorsById.get(r.vendorId)!;
                  return (
                    <li key={r.vendorId} className="text-muted">
                      <span className="font-medium text-fg">{v.name}</span> — its page blocked automated reading.{" "}
                      {v.website && <a className="text-primary underline underline-offset-2" href={v.website} target="_blank" rel="noreferrer">Open it yourself</a>}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function SelectionBar() {
  const { state, go } = useMela();
  const { vendorsById } = useRecommendations();
  const v = state.selected.venue && vendorsById.get(state.selected.venue);
  const c = state.selected.catering && vendorsById.get(state.selected.catering);
  const done = state.research?.job.status !== "running";
  return (
    <div className="bottom-4 z-20 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-line bg-surface/95 p-3 pl-4 shadow-lg backdrop-blur sm:sticky">
      <div className="min-w-0 flex-1 text-[14px]">
        {v || c ? (
          <p><span className="text-muted">Venue</span> <strong className="font-medium">{v ? v.name : "—"}</strong> <span className="text-faint">·</span> <span className="text-muted">Caterer</span> <strong className="font-medium">{c ? c.name : "—"}</strong></p>
        ) : <p>Choose a venue and a caterer you like.</p>}
        <p className="text-[12px] text-faint">Choosing doesn&apos;t book, pay or contact anyone.</p>
      </div>
      <Button iconRight="arrow" disabled={!done} onClick={() => go("decide")} className="w-full sm:w-auto">Compare &amp; decide</Button>
    </div>
  );
}
