"use client";
// P07 Evidence drawer (95:1625): every verified fact with its verbatim quote, source URL and
// retrieved time; every unknown with its reason. Reviews are listed separately as opinions.
import { useState } from "react";
import type { Recommendation, Vendor } from "../../contracts";
import { formatTime } from "../../domain/util";
import { useMela } from "../../state/MelaProvider";
import { Button, Dialog, Icon } from "../primitives";
import { CheckRow, UNKNOWN_REASON, fieldLabel, hostOf, sortedChecks } from "./bits";

export function EvidenceButton({ vendor, rec, small }: { vendor: Vendor; rec: Recommendation; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const { state } = useMela();
  const facts = state.research?.facts.filter((f) => f.vendorId === vendor.id) ?? [];
  const reviews = state.research?.reviews.filter((r) => r.vendorId === vendor.id) ?? [];
  const id = `ev-${vendor.id}`;
  const checks = sortedChecks(rec);
  return (
    <>
      <Button size={small ? "sm" : "md"} variant="ghost" icon="globe" onClick={() => setOpen(true)} aria-label={`Evidence for ${vendor.name}: ${facts.length} source facts`}
        className="text-primary">
        Evidence{small ? "" : ` · ${facts.length}`}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={vendor.name} labelledBy={id} wide>
        <p className="text-[14px] text-muted">
          {vendor.fictional
            ? <><span className="font-medium text-sim">Fictional demo vendor.</span> These are recorded fixture facts, not a live read.</>
            : "Retrieved from public pages."}{" "}
          Every fact shows the exact words it came from.
        </p>

        <h3 className="mt-6 label-mono">How it matches your brief</h3>
        <ul className="mt-3 space-y-2">{checks.map((c) => <CheckRow key={c.requirementId} c={c} />)}</ul>

        <h3 className="mt-7 label-mono">What the sources say · {facts.length}</h3>
        {facts.length === 0 && <p className="mt-3 text-[14px] text-unk">No facts were read for this vendor.</p>}
        <ul className="mt-2 divide-y divide-line">
          {facts.map((f) => (
            <li key={f.id} className="py-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-[13px] font-medium">{fieldLabel(f.field)}</p>
                {f.qualifier && f.qualifier !== "exact" && <span className="text-[12px] font-medium text-est">{f.qualifier.replace("_", " ")}</span>}
              </div>
              {f.state === "verified" ? (
                <blockquote className="mt-1.5 border-l-2 border-ok/40 pl-3 text-[14px] leading-6">“{f.quote}”</blockquote>
              ) : (
                <p className={`mt-1.5 flex items-center gap-1.5 text-[14px] ${f.state === "conflicting" ? "text-held" : "text-unk"}`}>
                  <Icon name={f.state === "conflicting" ? "alert" : "question"} size={14} />
                  {f.state === "conflicting" ? "Sources disagree" : "Unknown"} — {f.unknownReason ? UNKNOWN_REASON[f.unknownReason] : "no reason recorded"}
                </p>
              )}
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
                {f.url
                  ? <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 break-all text-primary underline-offset-2 hover:underline">{hostOf(f.url)}<Icon name="external" size={12} /></a>
                  : <span>No source link</span>}
                {f.retrievedAt && <span>· retrieved {formatTime(f.retrievedAt)}</span>}
              </p>
            </li>
          ))}
        </ul>

        {reviews.length > 0 && (
          <>
            <h3 className="mt-7 label-mono">Public reviews · opinions, never policy</h3>
            <ul className="mt-3 space-y-2">
              {reviews.map((r) => (
                <li key={r.id} className="rounded-xl bg-research-soft/60 p-3.5 text-[13px]">
                  {r.excerpt && <p>“{r.excerpt}” {r.rating !== undefined && <span className="text-faint">· {r.rating}/5</span>}</p>}
                  <p className="mt-1 text-[12px] text-muted">{r.attribution} · {r.sampleContext} · retrieved {formatTime(r.retrievedAt)}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Dialog>
    </>
  );
}
