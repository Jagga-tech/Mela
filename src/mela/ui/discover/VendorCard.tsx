"use client";
// P05 Discover card: decision summary first (name, match, what still needs asking, price),
// the full check list and the evidence behind it one click away.
import { useId } from "react";
import type { Recommendation, Vendor } from "../../contracts";
import { useMela } from "../../state/MelaProvider";
import { Button } from "../primitives";
import { CheckRow, DisclosureSummary, MatchLine, PriceLine, Swatch, VendorMeta, attentionChecks, sortedChecks } from "./bits";
import { EvidenceButton } from "./Evidence";

const LABEL_TEXT = { best_fit: "Best fit", lowest_published_estimate: "Lowest published estimate", best_tradeoff: "Best trade-off" } as const;

export function VendorCard({ rec, vendor, delay }: { rec: Recommendation; vendor: Vendor; delay: number }) {
  const { state, select } = useMela();
  const selected = state.selected[vendor.category] === vendor.id;
  const all = sortedChecks(rec);
  const attention = attentionChecks(rec);
  const titleId = useId();
  return (
    <article aria-labelledby={titleId}
      className={`anim-rise flex flex-col rounded-2xl border bg-surface p-5 transition-shadow ${selected ? "border-primary shadow-[0_0_0_1px_var(--mela-action-primary)]" : "border-line"}`}
      style={{ animationDelay: `${delay}ms` }}>
      {rec.labels.length > 0 && (
        <p className="mb-3 text-[12px] font-medium uppercase tracking-wide text-primary">{rec.labels.map((l) => LABEL_TEXT[l]).join(" · ")}</p>
      )}
      <div className="flex items-start gap-3">
        <Swatch vendor={vendor} />
        <div className="min-w-0">
          <h3 id={titleId} className="text-[18px] font-medium leading-6">{vendor.name}</h3>
          <VendorMeta vendor={vendor} />
        </div>
      </div>

      <div className="mt-4"><MatchLine rec={rec} /></div>
      {attention.length > 0 && (
        <>
          <ul className="mt-2 space-y-1.5">{attention.slice(0, 3).map((c) => <CheckRow key={c.requirementId} c={c} />)}</ul>
          {attention.length > 3 && <p className="mt-1 text-[12px] text-faint">+{attention.length - 3} more below</p>}
        </>
      )}

      <div className="mt-4 border-t border-line pt-4"><PriceLine price={rec.price} /></div>

      {all.length > 0 && (
        <details className="mt-3">
          <DisclosureSummary>All {all.length} checks</DisclosureSummary>
          <ul className="mt-2 space-y-1.5">{all.map((c) => <CheckRow key={c.requirementId} c={c} />)}</ul>
        </details>
      )}

      <div className="mt-auto flex items-center gap-2 pt-5">
        <Button className="flex-1" variant={selected ? "secondary" : "primary"} icon={selected ? "check" : undefined} aria-pressed={selected}
          aria-label={`${selected ? "Chosen" : "Choose"} ${vendor.name}`} onClick={() => select(vendor.category, selected ? null : vendor.id)}>
          {selected ? "Chosen" : "Choose"}
        </Button>
        <EvidenceButton vendor={vendor} rec={rec} />
      </div>
    </article>
  );
}
