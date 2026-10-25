"use client";
// P06 Decide (95:1076): one confident choice. Must-haves first, no fit percentages, chosen ≠ booked.
// Rows that are verified for every option collapse into one line ("Verified for all"), so the table
// shows where the options actually differ. Phones get one card per option instead of a wide table.
import { useState } from "react";
import type { Recommendation, RequirementCheck, VendorCategory } from "../contracts";
import { budgetLines } from "../domain/match";
import { usd } from "../domain/util";
import { useMela } from "../state/MelaProvider";
import { useRecommendations } from "../state/derived";
import { Button, Icon } from "../ui/primitives";
import { CheckRow, DisclosureSummary, MatchLine, PriceLine, RESULT, Swatch, VendorMeta, attentionChecks, sortedChecks } from "../ui/discover/bits";
import { EvidenceButton } from "../ui/discover/Evidence";

const ORDER = { MUST_HAVE: 0, PREFERENCE: 1, FLEXIBLE: 2, UNSET: 3 } as const;
const PRIORITY_WORD = { MUST_HAVE: "Must-have", PREFERENCE: "Preference", FLEXIBLE: "Flexible", UNSET: "" } as const;

export function DecideScreen() {
  const { state, prepareCall, busy, go } = useMela();
  const recs = useRecommendations();
  const venue = state.selected.venue ? recs.recById.get(state.selected.venue) : undefined;
  const catering = state.selected.catering ? recs.recById.get(state.selected.catering) : undefined;
  const venueName = venue && recs.vendorsById.get(venue.vendorId)?.name;
  return (
    <div className="space-y-10 pb-4">
      <header className="space-y-2">
        <h1 tabIndex={-1} className="font-serif text-[30px] leading-tight outline-none sm:text-[34px]">Side by side</h1>
        <p className="max-w-[640px] text-[15px] text-muted">Choosing doesn&apos;t book or pay for anything. It tells Mela which venue to prepare a call for, and you can change your mind.</p>
      </header>
      <Compare category="venue" />
      <Compare category="catering" />
      <Budget venue={venue} catering={catering} />
      <div className="bottom-4 z-20 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-line bg-surface/95 p-3 pl-4 shadow-lg backdrop-blur sm:sticky">
        <div className="min-w-0 flex-1 text-[14px]">
          <p>{venue ? <><strong className="font-medium">{venueName}</strong> it is. Nothing is booked.</> : "Choose a venue to prepare a call plan."}</p>
          <p className="text-[12px] text-faint">You&apos;ll review exactly what Mela would ask before any call happens.</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button variant="ghost" icon="back" onClick={() => go("discover")}>Results</Button>
          <Button iconRight="arrow" className="flex-1 sm:flex-none" disabled={!venue} loading={busy === "call_plan"} onClick={prepareCall}>Prepare a call plan</Button>
        </div>
      </div>
    </div>
  );
}

function Compare({ category }: { category: VendorCategory }) {
  const { state } = useMela();
  const { [category]: view } = useRecommendations();
  const [showAll, setShowAll] = useState(false);
  const cols = view.list.top;
  const noun = category === "venue" ? "Venues" : "Caterers";
  const headingId = `cmp-${category}`;
  if (!cols.length) return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-3 text-[20px] font-medium">{noun}</h2>
      <p className="rounded-2xl border border-line bg-surface p-5 text-[14px] text-muted">No {noun.toLowerCase()} met every known must-have. Edit your brief to relax one, or see “Left out” in the results.</p>
    </section>
  );

  // Every requirement any option was checked against, must-haves first.
  const byId = new Map<string, RequirementCheck>();
  for (const r of cols) for (const c of r.checks) if (!byId.has(c.requirementId)) byId.set(c.requirementId, c);
  const cell = (r: Recommendation, id: string) => r.checks.find((c) => c.requirementId === id);
  const allMeet = (id: string) => cols.every((r) => cell(r, id)?.result === "meets");
  const allFlexible = (id: string) => cols.every((r) => cell(r, id)?.result === "not_applicable");
  // Same rule as before: a requirement nobody set and nobody checked isn't shown.
  const rows = [...byId.values()].filter((r) => !(allFlexible(r.requirementId) && r.priority !== "FLEXIBLE"))
    .sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
  const same = rows.filter((r) => allMeet(r.requirementId));
  const flexible = rows.filter((r) => allFlexible(r.requirementId));
  const differing = rows.filter((r) => !allMeet(r.requirementId) && !allFlexible(r.requirementId));
  const shown = showAll ? rows : differing;
  const hiddenCount = same.length + flexible.length;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-[20px] font-medium">{noun}</h2>
        {hiddenCount > 0 && (
          <button className="text-[13px] font-medium text-primary underline-offset-2 hover:underline" aria-expanded={showAll} onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show only differences" : `Show all ${rows.length} requirements`}
          </button>
        )}
      </div>
      {!showAll && (same.length > 0 || flexible.length > 0) && (
        <div className="space-y-1 text-[13px] text-muted">
          {same.length > 0 && <p className="flex gap-1.5"><span className="mt-0.5 text-ok"><Icon name="check" size={14} /></span><span><span className="font-medium text-fg">Verified for {cols.length > 1 ? "all" : "this option"}:</span> {same.map((r) => r.label).join(" · ")}</span></p>}
          {flexible.length > 0 && <p className="flex gap-1.5"><span className="mt-0.5 text-faint"><Icon name="dot" size={14} /></span><span><span className="font-medium text-fg">Flexible for you:</span> {flexible.map((r) => r.label).join(" · ")}</span></p>}
        </div>
      )}

      {/* md and up: compact comparison table */}
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface md:block">
        <table className="w-full table-fixed border-collapse text-[14px]">
          <caption className="sr-only">{noun} compared against your brief{showAll ? "" : " — only rows where they differ"}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="w-[26%] p-4 text-left align-bottom"><span className="label-mono">{shown.length ? "Where they differ" : ""}</span></th>
              {cols.map((r) => <VendorHead key={r.vendorId} rec={r} category={category} />)}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.requirementId} className="border-b border-line">
                <th scope="row" className="p-4 text-left align-top font-normal">
                  <p className="font-medium">{row.label}</p>
                  {PRIORITY_WORD[row.priority] && <p className="text-[12px] text-faint">{PRIORITY_WORD[row.priority]}</p>}
                </th>
                {cols.map((r) => <ResultCell key={r.vendorId} c={cell(r, row.requirementId)} chosen={state.selected[category] === r.vendorId} />)}
              </tr>
            ))}
            <tr className="border-b border-line">
              <th scope="row" className="p-4 text-left align-top font-medium">Price</th>
              {cols.map((r) => <td key={r.vendorId} className={`p-4 align-top ${state.selected[category] === r.vendorId ? "bg-primary-soft/40" : ""}`}><PriceLine price={r.price} /></td>)}
            </tr>
            <tr>
              <th scope="row" className="p-4 text-left font-medium"><span className="sr-only">Your choice</span></th>
              {cols.map((r) => <td key={r.vendorId} className={`p-4 align-top ${state.selected[category] === r.vendorId ? "bg-primary-soft/40" : ""}`}><ChooseActions rec={r} category={category} /></td>)}
            </tr>
          </tbody>
        </table>
      </div>

      {/* phones: one card per option */}
      <ul className="space-y-3 md:hidden">
        {cols.map((r) => <MobileOption key={r.vendorId} rec={r} category={category} />)}
      </ul>
    </section>
  );
}

function VendorHead({ rec, category }: { rec: Recommendation; category: VendorCategory }) {
  const { state } = useMela();
  const { vendorsById } = useRecommendations();
  const v = vendorsById.get(rec.vendorId)!;
  const chosen = state.selected[category] === v.id;
  return (
    <th scope="col" className={`p-4 text-left align-top font-normal ${chosen ? "bg-primary-soft/40" : ""}`}>
      <div className="flex items-start gap-2.5">
        <Swatch vendor={v} size={28} />
        <div className="min-w-0">
          <p className="text-[16px] font-medium leading-5">{v.name}</p>
          <VendorMeta vendor={v} />
        </div>
      </div>
      <div className="mt-2"><MatchLine rec={rec} /></div>
    </th>
  );
}

function ResultCell({ c, chosen }: { c?: RequirementCheck; chosen: boolean }) {
  const tint = chosen ? "bg-primary-soft/40" : "";
  if (!c) return <td className={`p-4 align-top text-[13px] text-unk ${tint}`}>Not checked</td>;
  const r = RESULT[c.result];
  return (
    <td className={`p-4 align-top ${tint}`}>
      <p className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${r.cls}`}><Icon name={r.icon} size={14} />{r.word}</p>
      {c.result !== "not_applicable" && <p className="mt-0.5 text-[13px] text-muted">{c.note}</p>}
    </td>
  );
}

function ChooseActions({ rec, category }: { rec: Recommendation; category: VendorCategory }) {
  const { state, select } = useMela();
  const { vendorsById } = useRecommendations();
  const v = vendorsById.get(rec.vendorId)!;
  const chosen = state.selected[category] === v.id;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button size="sm" variant={chosen ? "secondary" : "primary"} icon={chosen ? "check" : undefined} aria-pressed={chosen}
        aria-label={`${chosen ? "Chosen" : "Choose"} ${v.name}`} onClick={() => select(category, chosen ? null : v.id)}>
        {chosen ? "Chosen" : "Choose"}
      </Button>
      <EvidenceButton vendor={v} rec={rec} small />
    </div>
  );
}

function MobileOption({ rec, category }: { rec: Recommendation; category: VendorCategory }) {
  const { state } = useMela();
  const { vendorsById } = useRecommendations();
  const v = vendorsById.get(rec.vendorId)!;
  const chosen = state.selected[category] === v.id;
  const attention = attentionChecks(rec);
  const all = sortedChecks(rec);
  return (
    <li className={`rounded-2xl border bg-surface p-4 ${chosen ? "border-primary" : "border-line"}`}>
      <div className="flex items-start gap-3">
        <Swatch vendor={v} size={32} />
        <div className="min-w-0">
          <p className="text-[16px] font-medium">{v.name}</p>
          <VendorMeta vendor={v} />
        </div>
      </div>
      <div className="mt-3"><MatchLine rec={rec} /></div>
      {attention.length > 0 && <ul className="mt-2 space-y-1.5">{attention.map((c) => <CheckRow key={c.requirementId} c={c} />)}</ul>}
      <div className="mt-3 border-t border-line pt-3"><PriceLine price={rec.price} /></div>
      {all.length > 0 && (
        <details className="mt-2">
          <DisclosureSummary>All {all.length} checks</DisclosureSummary>
          <ul className="mt-2 space-y-1.5">{all.map((c) => <CheckRow key={c.requirementId} c={c} />)}</ul>
        </details>
      )}
      <div className="mt-3"><ChooseActions rec={rec} category={category} /></div>
    </li>
  );
}

function Budget({ venue, catering }: { venue?: Recommendation; catering?: Recommendation }) {
  const { state } = useMela();
  if (!state.brief) return null;
  const lines = budgetLines(state.brief, { venue, catering });
  return (
    <section aria-labelledby="budget-h" className="space-y-3">
      <h2 id="budget-h" className="text-[20px] font-medium">Budget</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {lines.map((l) => {
          const over = l.remainingCents !== null && l.remainingCents < 0;
          return (
            <div key={l.category} className="rounded-2xl border border-line bg-surface p-5">
              <p className="label-mono">{l.label}</p>
              <p className="mt-2 font-mono text-[24px] leading-tight">{l.price.amountCents === null ? <span className="text-unk">Unknown</span> : usd(l.price.amountCents)}</p>
              <div className="mt-1"><PriceLine price={l.price} /></div>
              {l.capCents !== null && (
                <p className={`mt-3 flex items-center gap-1.5 text-[13px] ${l.remainingCents === null ? "text-unk" : over ? "text-warn" : "text-ok"}`}>
                  <Icon name={l.remainingCents === null ? "question" : over ? "alert" : "check"} size={14} />
                  {l.remainingCents === null ? `Cap ${usd(l.capCents)} · can't compare until there's a price` : over ? `${usd(-l.remainingCents)} over your ${usd(l.capCents)} cap` : `${usd(l.remainingCents)} under your ${usd(l.capCents)} cap`}
                </p>
              )}
              {l.capCents === null && l.category === "catering" && state.brief!.budget.scope === "venue_only" && <p className="mt-3 text-[13px] text-faint">No catering budget set — your cap covers the venue only.</p>}
            </div>
          );
        })}
      </div>
      <p className="text-[12px] text-faint">Published and estimated prices come from vendor pages. Fees not listed are unknown, not zero.</p>
    </section>
  );
}
