"use client";
// P06 Decide (95:1076): one confident choice. Must-haves first, no fit percentages, chosen ≠ booked.
import type { Recommendation, VendorCategory } from "../contracts";
import { budgetLines, priceTypeLabel } from "../domain/match";
import { usd } from "../domain/util";
import { useMela } from "../state/MelaProvider";
import { useRecommendations } from "../state/derived";
import { MelaOrb } from "../ui/MelaOrb";
import { Badge, Button, Card, Icon, SectionLabel } from "../ui/primitives";
import { EvidenceButton, priceBadge } from "./DiscoverScreen";

export function DecideScreen() {
  const { state, prepareCall, busy, go } = useMela();
  const recs = useRecommendations();
  const venue = state.selected.venue ? recs.recById.get(state.selected.venue) : undefined;
  const catering = state.selected.catering ? recs.recById.get(state.selected.catering) : undefined;
  const venueName = venue && recs.vendorsById.get(venue.vendorId)?.name;
  return (
    <div className="space-y-8">
      <div>
        <h1 tabIndex={-1} className="font-serif text-[34px] leading-tight outline-none">Side by side</h1>
        <p className="mt-1 text-[14px] text-muted">Choosing doesn&apos;t book or pay for anything. It tells Mela which venue to prepare a call for — and you can change your mind.</p>
      </div>
      <Compare category="venue" />
      <Compare category="catering" />
      <Budget venue={venue} catering={catering} />
      <div className="bottom-4 z-20 sm:sticky flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 pl-4 shadow-lg backdrop-blur">
        <MelaOrb state={venue ? "inviting" : "idle"} size={36} decorative />
        <p className="flex-1 text-[14px]">
          {venue ? <><strong>{venueName}</strong> it is — nothing is booked. Next, review exactly what Mela would ask and share. No call happens until you approve it.</> : "Choose a venue above to prepare a call plan."}
        </p>
        <Button variant="ghost" onClick={() => go("discover")}>Back to results</Button>
        <Button iconRight="arrow" disabled={!venue} loading={busy === "call_plan"} onClick={prepareCall}>Prepare a call plan</Button>
      </div>
    </div>
  );
}

function Compare({ category }: { category: VendorCategory }) {
  const { state, select } = useMela();
  const { [category]: view, vendorsById } = useRecommendations();
  const cols = view.list.top;
  const noun = category === "venue" ? "Venues" : "Caterers";
  if (!cols.length) return (
    <Card className="p-5 text-[14px] text-muted">No {noun.toLowerCase()} met every known must-have. Edit your brief to relax one, or see “Didn&apos;t make it” in the results.</Card>
  );
  const rows = cols[0].checks.filter((c) => c.result !== "not_applicable" || c.priority === "FLEXIBLE")
    .sort((a, b) => (a.priority === "MUST_HAVE" ? 0 : a.priority === "PREFERENCE" ? 1 : 2) - (b.priority === "MUST_HAVE" ? 0 : b.priority === "PREFERENCE" ? 1 : 2));
  const cell = (r: Recommendation, id: string) => r.checks.find((c) => c.requirementId === id);
  return (
    <section aria-labelledby={`cmp-${category}`}>
      <h2 id={`cmp-${category}`} className="mb-3 text-[20px] font-medium">{noun}</h2>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-[14px]">
          <caption className="sr-only">{noun} compared against your brief</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="w-[28%] p-4 text-left"><SectionLabel>What matters to you</SectionLabel></th>
              {cols.map((r) => {
                const v = vendorsById.get(r.vendorId)!;
                const chosen = state.selected[category] === v.id;
                return (
                  <th key={r.vendorId} scope="col" className={`p-4 text-left align-top ${chosen ? "bg-primary-soft" : ""}`}>
                    <p className="text-[16px] font-medium">{v.name}</p>
                    <p className="text-[12px] font-normal text-faint">{v.area}{v.fictional ? " · fictional" : ""}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {r.matchStatus === "verified_match" ? <Badge kind="verified">All must-haves verified</Badge> : <Badge kind="unknown">Needs confirmation</Badge>}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.requirementId} className="border-b border-line last:border-0">
                <th scope="row" className="p-4 text-left align-top font-normal">
                  <p className="font-medium">{row.label}</p>
                  <p className="font-mono text-[11px] uppercase tracking-wide text-faint">{row.priority.replace("_", "-").toLowerCase()}</p>
                </th>
                {cols.map((r) => {
                  const c = cell(r, row.requirementId);
                  if (!c) return <td key={r.vendorId} className="p-4 text-faint">—</td>;
                  const kind = c.result === "meets" ? "verified" : c.result === "violates" ? "excluded" : c.result === "conflicting" ? "conflicting" : c.result === "unknown" ? "unknown" : "draft";
                  const text = c.result === "meets" ? "Verified" : c.result === "violates" ? "No" : c.result === "conflicting" ? "Sources disagree" : c.result === "unknown" ? "Unknown — ask" : "Flexible";
                  return (
                    <td key={r.vendorId} className={`p-4 align-top ${state.selected[category] === r.vendorId ? "bg-primary-soft/50" : ""}`}>
                      <Badge kind={kind}>{text}</Badge>
                      {c.result !== "not_applicable" && <p className="mt-1 text-[12px] text-muted">{c.note}</p>}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t border-line bg-subtle/50">
              <th scope="row" className="p-4 text-left font-medium">Price</th>
              {cols.map((r) => (
                <td key={r.vendorId} className="p-4 align-top">
                  <Badge kind={priceBadge(r.price.priceType)}>{priceTypeLabel[r.price.priceType]}</Badge>
                  <p className="mt-1 font-mono text-[13px]">{r.price.note}</p>
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="p-4 text-left font-medium">Your choice</th>
              {cols.map((r) => {
                const v = vendorsById.get(r.vendorId)!;
                const chosen = state.selected[category] === v.id;
                return (
                  <td key={r.vendorId} className="p-4">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant={chosen ? "secondary" : "primary"} icon={chosen ? "check" : undefined} aria-pressed={chosen} onClick={() => select(category, chosen ? null : v.id)}>
                        {chosen ? "Chosen" : "Choose"}
                      </Button>
                      <EvidenceButton vendor={v} rec={r} small />
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Budget({ venue, catering }: { venue?: Recommendation; catering?: Recommendation }) {
  const { state } = useMela();
  if (!state.brief) return null;
  const lines = budgetLines(state.brief, { venue, catering });
  return (
    <section aria-labelledby="budget-h">
      <h2 id="budget-h" className="mb-3 text-[20px] font-medium">Budget</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {lines.map((l) => (
          <Card key={l.category} className="p-4">
            <SectionLabel>{l.label}</SectionLabel>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <p className="font-mono text-[22px]">{l.price.amountCents === null ? "Unknown" : usd(l.price.amountCents)}</p>
              <Badge kind={priceBadge(l.price.priceType)}>{priceTypeLabel[l.price.priceType]}</Badge>
            </div>
            <p className="mt-1 text-[13px] text-muted">{l.price.note}</p>
            {l.capCents !== null && (
              <p className={`mt-2 flex items-center gap-1.5 text-[13px] ${l.remainingCents !== null && l.remainingCents < 0 ? "text-warn" : "text-ok"}`}>
                <Icon name={l.remainingCents !== null && l.remainingCents < 0 ? "alert" : "check"} size={14} />
                {l.remainingCents === null ? `Cap ${usd(l.capCents)} · can't compare until there's a price` : l.remainingCents >= 0 ? `${usd(l.remainingCents)} under your ${usd(l.capCents)} cap` : `${usd(-l.remainingCents)} over your ${usd(l.capCents)} cap`}
              </p>
            )}
            {l.capCents === null && l.category === "catering" && state.brief!.budget.scope === "venue_only" && <p className="mt-2 text-[13px] text-faint">No catering budget set — your cap covers the venue only.</p>}
          </Card>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-faint">Published and estimated prices come from vendor pages. Fees not listed are unknown, not zero.</p>
    </section>
  );
}
