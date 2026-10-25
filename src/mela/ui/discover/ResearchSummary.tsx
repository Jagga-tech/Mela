"use client";
// P04 Researching (94:433), compact: one line of counts that names every non-happy state
// (slow / partial / empty / blocked / failed), with the full per-source list one click away.
import type { ResearchJob, ResearchSource } from "../../contracts";
import { formatTime } from "../../domain/util";
import { Button, Icon, type IconName } from "../primitives";
import { DisclosureSummary, hostOf } from "./bits";

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

const SETTLED: ResearchSource["status"][] = ["found", "partial", "empty", "blocked", "error"];
// Order and wording of the counts in the summary line. "found" is the quiet happy path.
const TALLY: { status: ResearchSource["status"]; word: string }[] = [
  { status: "found", word: "read" },
  { status: "partial", word: "partial" },
  { status: "slow", word: "slow" },
  { status: "empty", word: "empty" },
  { status: "blocked", word: "blocked" },
  { status: "error", word: "failed" },
];

export function ResearchSummary({ job, onStop, stopping }: { job: ResearchJob; onStop: () => void; stopping: boolean }) {
  const { sources } = job;
  const running = job.status === "running";
  const settled = sources.filter((s) => SETTLED.includes(s.status)).length;
  const problems = sources.filter((s) => ["partial", "empty", "blocked", "error"].includes(s.status)).length;
  const counts = TALLY.map((t) => ({ ...t, n: sources.filter((s) => s.status === t.status).length })).filter((t) => t.n > 0);
  const inFlight = sources.filter((s) => ["searching", "fetching", "extracting"].includes(s.status)).length;
  const queued = sources.filter((s) => s.status === "queued").length;
  if (inFlight) counts.push({ status: "fetching", word: "in progress", n: inFlight });
  if (queued) counts.push({ status: "queued", word: "queued", n: queued });
  const pct = sources.length ? Math.round((settled / sources.length) * 100) : 0;

  return (
    <section aria-labelledby="src-h" className="rounded-2xl border border-line bg-surface px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={running ? "text-research" : problems ? "text-est" : "text-ok"}>
          <Icon name={running ? "spinner" : problems ? "alert" : "check"} size={18} />
        </span>
        <div className="min-w-0 flex-1" aria-live="polite">
          <h2 id="src-h" className="text-[15px] font-medium">
            {running ? `Checking sources · ${settled} of ${sources.length} done` : `${sources.length} source${sources.length === 1 ? "" : "s"} checked`}
          </h2>
          <p className="text-[13px] text-muted">
            {counts.length === 0 ? "Waiting to start" : counts.map((c, i) => (
              <span key={c.status}>
                {i > 0 && " · "}
                <span className={c.status === "found" || c.status === "queued" ? "" : `font-medium ${STATUS[c.status].cls}`}>{c.n} {c.word}</span>
              </span>
            ))}
            {job.status === "cancelled" && " · stopped by you"}
          </p>
        </div>
        {running && <Button size="sm" variant="secondary" icon="x" onClick={onStop} loading={stopping}>Stop</Button>}
      </div>
      {running && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label="Sources settled" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-research transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
      {job.status === "cancelled" && <p className="mt-2 text-[13px] text-muted">You stopped the research. Results so far are kept; nothing else was fetched.</p>}
      <details className="mt-2">
        <DisclosureSummary>Show every source</DisclosureSummary>
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {sources.map((s) => {
            const st = STATUS[s.status];
            return (
              <li key={s.id} className="flex items-start gap-2.5 py-2.5 text-[13px]">
                <span className={`mt-0.5 ${st.cls}`}><Icon name={st.icon} size={15} /></span>
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{s.label}</p>
                  <p className="text-faint">
                    {s.error ?? (s.fetchedAt ? `Checked ${formatTime(s.fetchedAt)}` : s.status === "queued" ? "Waiting" : "In progress")}
                    {s.url && !s.label.includes(hostOf(s.url)) && <> · <a className="text-primary underline-offset-2 hover:underline" href={s.url} target="_blank" rel="noreferrer">{hostOf(s.url)}</a></>}
                  </p>
                </div>
                <span className={`shrink-0 text-[12px] font-medium ${st.cls}`}>{st.label}</span>
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
