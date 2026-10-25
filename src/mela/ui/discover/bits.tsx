"use client";
// Small presentational pieces shared by the Discover and Decide screens.
// Status is shown as icon + word (not a chip per row) so cards stay calm, but every
// unknown / estimate / fictional label is still visible text on the item it describes.
import type { Recommendation, RequirementCheck, SourceFact, Vendor } from "../../contracts";
import { priceTypeLabel } from "../../domain/match";
import { Icon, type BadgeKind, type IconName } from "../primitives";

export const RESULT: Record<RequirementCheck["result"], { icon: IconName; cls: string; word: string }> = {
  meets: { icon: "check", cls: "text-ok", word: "Verified" },
  violates: { icon: "x", cls: "text-warn", word: "Doesn't meet" },
  unknown: { icon: "question", cls: "text-unk", word: "Unknown — ask" },
  conflicting: { icon: "alert", cls: "text-held", word: "Sources disagree" },
  not_applicable: { icon: "dot", cls: "text-faint", word: "Flexible" },
};

const PRIORITY_ORDER = { MUST_HAVE: 0, PREFERENCE: 1, FLEXIBLE: 2, UNSET: 3 } as const;

/** Checks that matter for this vendor, must-haves first. */
export function sortedChecks(rec: Recommendation) {
  return rec.checks.filter((c) => c.result !== "not_applicable").sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

/** Checks the host should look at: anything not verified. */
export function attentionChecks(rec: Recommendation) {
  return sortedChecks(rec).filter((c) => c.result !== "meets");
}

export function mustHaveTally(rec: Recommendation) {
  const must = rec.checks.filter((c) => c.priority === "MUST_HAVE");
  return { met: must.filter((c) => c.result === "meets").length, total: must.length };
}

export function priceBadge(t: Recommendation["price"]["priceType"]): BadgeKind {
  return t === "published" ? "verified" : t === "estimated" ? "estimated" : t === "verbal" ? "verbal" : t === "simulated" ? "simulated" : "unknown";
}

const PRICE_TONE: Record<Recommendation["price"]["priceType"], { cls: string; icon: IconName }> = {
  published: { cls: "text-ok", icon: "check" },
  written_quote: { cls: "text-ok", icon: "file" },
  estimated: { cls: "text-est", icon: "alert" },
  verbal: { cls: "text-est", icon: "phone" },
  simulated: { cls: "text-sim", icon: "file" },
  unknown: { cls: "text-unk", icon: "question" },
};

/** Price note + its evidence type ("Published", "Estimate", "Unknown"…), always visible together. */
export function PriceLine({ price, size = "md" }: { price: Recommendation["price"]; size?: "md" | "lg" }) {
  const t = PRICE_TONE[price.priceType];
  return (
    <div>
      <p className={`font-mono ${size === "lg" ? "text-[20px]" : "text-[14px]"} leading-snug`}>{price.note}</p>
      <p className={`mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium ${t.cls}`}>
        <Icon name={t.icon} size={12} />{priceTypeLabel[price.priceType]} price
      </p>
    </div>
  );
}

export function MatchLine({ rec }: { rec: Recommendation }) {
  const { met, total } = mustHaveTally(rec);
  if (rec.matchStatus === "verified_match") {
    return <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ok"><Icon name="check" size={14} />{total ? `Meets all ${total} must-haves` : "Meets every must-have"}</p>;
  }
  if (rec.matchStatus === "excluded") {
    return <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-warn"><Icon name="x" size={14} />Fails a must-have</p>;
  }
  return (
    <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-unk">
      <Icon name="question" size={14} />Possible — {total - met} of {total} must-have{total === 1 ? "" : "s"} to confirm
    </p>
  );
}

/** "Oakland · Fruitvale" plus a visible fictional-vendor label. */
export function VendorMeta({ vendor }: { vendor: Vendor }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted">
      <span>{vendor.area}</span>
      {vendor.fictional && <span className="inline-flex items-center gap-1 text-[12px] text-sim"><Icon name="file" size={12} />Fictional demo vendor</span>}
    </p>
  );
}

export function Swatch({ vendor, size = 40 }: { vendor: Vendor; size?: number }) {
  const [a, b] = vendor.palette ?? ["#e9e1f3", "#f3e6d8"];
  return <span aria-hidden className="shrink-0 rounded-xl" style={{ width: size, height: size, background: `linear-gradient(135deg, ${a}, ${b})` }} />;
}

export function CheckRow({ c }: { c: RequirementCheck }) {
  const r = RESULT[c.result];
  return (
    <li className="flex gap-2 text-[13px] leading-5">
      <span className={`mt-0.5 ${r.cls}`}><Icon name={r.icon} size={14} label={r.word} /></span>
      <span>
        <span className="font-medium">{c.label}</span>
        {c.priority === "MUST_HAVE" && <span className="text-faint"> · must</span>}
        <span className="text-muted"> — {c.note}</span>
      </span>
    </li>
  );
}

export function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export const UNKNOWN_REASON: Record<NonNullable<SourceFact["unknownReason"]>, string> = {
  not_on_page: "not stated on the page",
  quote_mismatch: "quote didn't match the page",
  source_failed: "source couldn't be read",
  sources_disagree: "sources disagree",
};

export function fieldLabel(f: string) {
  const s = f.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Chevron-style summary used by every <details> on these screens. */
export function DisclosureSummary({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <summary className={`group flex cursor-pointer list-none items-center gap-1.5 rounded-md text-[13px] font-medium text-primary [&::-webkit-details-marker]:hidden ${className}`}>
      <svg aria-hidden viewBox="0 0 24 24" width={14} height={14} className="transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
      {children}
    </summary>
  );
}
