"use client";
// P10 Handoff (96:1920) · P11 Exception (97:1835) · P12 Decision (97:2033) · P13 Audit (98:2049).
// Mela Events is the planning business; this is its AP seat, not the host's planning view.
import { useState } from "react";
import type { FinanceCase, ManagerDecision } from "../contracts";
import { formatTime, usd } from "../domain/util";
import { useMela } from "../state/MelaProvider";
import { MelaOrb } from "../ui/MelaOrb";
import { Badge, Button, Card, Dialog, Icon, SectionLabel } from "../ui/primitives";
import * as fx from "../fixtures/oakland-baby-shower";

export function HandoffScreen() {
  const { state, openFinance, busy, go } = useMela();
  const venue = state.research?.vendors.find((v) => v.id === state.selected.venue);
  return (
    <div className="anim-handoff mx-auto max-w-[760px] pt-6">
      <div className="flex items-center gap-4">
        <MelaOrb state="handoff" size={72} />
        <div>
          <SectionLabel>Role switch</SectionLabel>
          <h1 tabIndex={-1} className="font-serif text-[36px] leading-tight outline-none">From the host to Mela Events operations</h1>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <SectionLabel>The host&apos;s planning</SectionLabel>
          <p className="mt-2 text-[15px]">The host chose {venue?.name ?? "a venue"} and asked questions. Nothing was booked or paid.</p>
        </Card>
        <Card className="border-[#2f4f6b]/30 p-5">
          <SectionLabel>Mela Events · accounts payable</SectionLabel>
          <p className="mt-2 text-[15px]">The planning business tracks vendor commitments and checks every invoice against the approved quote before anyone pays.</p>
        </Card>
      </div>
      <div className="mt-4 rounded-2xl bg-sim-soft p-5 text-[14px] text-sim">
        <p className="font-medium">This part is a simulated record.</p>
        <p className="mt-1">It assumes {venue?.name ?? "the venue"} later sent a written quote built from its published prices, the host approved it, and an invoice arrived. The R-02 matching rule and the approval gate run in code. No Hyphenate API is called and no money moves.</p>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button size="lg" iconRight="arrow" loading={busy === "finance"} onClick={openFinance}>Open the AP inbox as {fx.scenario.manager.name.split(" ")[0]} (AP manager)</Button>
        <Button size="lg" variant="ghost" onClick={() => go("summary")}>Skip to the host summary</Button>
      </div>
    </div>
  );
}

const RESULT = {
  match: { text: "Matches quote", cls: "text-ok", icon: "check" },
  not_in_quote: { text: "Not in approved quote", cls: "text-warn", icon: "alert" },
  amount_differs: { text: "Amount differs from quote", cls: "text-warn", icon: "alert" },
  missing_on_invoice: { text: "On quote, not invoiced", cls: "text-unk", icon: "question" },
} as const;

export function OpsScreen() {
  const { state } = useMela();
  const fc = state.financeCase;
  const [tab, setTab] = useState<"exception" | "audit">("exception");
  if (!fc) return null;
  const decided = fc.decisions.length > 0 && fc.exception?.status !== "waiting_vendor";
  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-3" aria-label="AP queue">
        <SectionLabel>Needs a human · {fc.exception && !decided ? 1 : 0}</SectionLabel>
        {fc.exception && (
          <div className={`rounded-xl border p-3 text-[13px] ${decided ? "border-line bg-surface" : "border-held/40 bg-held-soft"}`}>
            <div className="flex items-center justify-between"><span className="font-medium">{fc.exception.id} · {fc.quote.vendorName}</span><Badge kind={decided ? "approved" : "held"}>{decided ? "Decided" : "Held"}</Badge></div>
            <p className="mt-1 font-mono text-[12px]">{fc.invoice.id} · +{usd(fc.exception.deltaCents, { exact: true })} not in quote</p>
          </div>
        )}
        <p className="text-[12px] text-faint">Mela clears exact matches on its own and logs them. Anything else stops here for a person.</p>
        <div role="tablist" aria-label="View" className="flex gap-1 rounded-xl bg-subtle p-1">
          {(["exception", "audit"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] ${tab === t ? "bg-surface font-medium shadow-sm" : "text-muted"}`}>
              {t === "exception" ? "Exception" : `Audit · ${fc.audit.length}`}
            </button>
          ))}
        </div>
      </aside>
      <div>{tab === "exception" ? <Exception fc={fc} onShowAudit={() => setTab("audit")} /> : <Audit fc={fc} />}</div>
    </div>
  );
}

function Exception({ fc, onShowAudit }: { fc: FinanceCase; onShowAudit: () => void }) {
  const { go } = useMela();
  const ex = fc.exception;
  const [deciding, setDeciding] = useState(false);
  const failing = fc.lineResults.filter((l) => l.result === "not_in_quote" || l.result === "amount_differs");
  const decided = fc.decisions.at(-1);
  const pct = ex ? ((ex.deltaCents / fc.quote.totalCents) * 100).toFixed(1) : "0";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-mono">Exception {ex?.id ?? "—"} · {fc.invoice.id} · quote {fc.quote.id}</p>
          <h1 tabIndex={-1} className="mt-1 font-serif text-[32px] leading-tight outline-none">
            {ex ? `${fc.quote.vendorName} billed ${usd(ex.deltaCents)} more than the host approved` : `${fc.invoice.id} matches the approved quote`}
          </h1>
        </div>
        <div className="flex gap-2"><Badge kind="simulated">{fc.origin.label}</Badge>{fc.paymentDraft.status === "held" && <Badge kind="held">Payment held</Badge>}</div>
      </div>

      {ex && (
        <div className="flex items-start gap-4 rounded-2xl border border-held/40 bg-surface p-4">
          <MelaOrb state={decided ? "succeeded" : "caution"} size={52} />
          <p className="text-[16px] leading-7">
            {decided
              ? `${decided.actor.name} decided: ${decided.decision.replace("_", " ")}. “${decided.reason}”`
              : <>I held payment draft {fc.paymentDraft.id}. {failing.map((l) => `“${l.label}” (${usd(l.diffCents, { exact: true })})`).join(", ")} isn&apos;t in quote {fc.quote.id}, which the host approved for {usd(fc.quote.totalCents, { exact: true })}. I&apos;m not allowed to approve this — it needs you.</>}
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[620px] text-[14px]">
          <caption className="sr-only">Invoice lines checked against the approved quote</caption>
          <thead>
            <tr className="border-b border-line text-left"><th className="p-3 label-mono font-normal">Line item</th><th className="p-3 text-right label-mono font-normal">Quote {fc.quote.id}</th><th className="p-3 text-right label-mono font-normal">Invoice {fc.invoice.id}</th><th className="p-3 text-right label-mono font-normal">Difference</th><th className="p-3 label-mono font-normal">Rule R-02</th></tr>
          </thead>
          <tbody>
            {fc.lineResults.map((l) => {
              const bad = l.result === "not_in_quote" || l.result === "amount_differs";
              const r = RESULT[l.result];
              return (
                <tr key={(l.invoiceLineId ?? "") + (l.quoteLineId ?? "")} className={`border-b border-line ${bad ? "anim-emphasis border-l-4 border-l-warn bg-warn-soft" : ""}`}>
                  <td className="p-3">{l.invoiceLineId ?? l.quoteLineId} · {l.label}</td>
                  <td className="p-3 text-right font-mono">{l.quoteCents === null ? "—" : usd(l.quoteCents, { exact: true })}</td>
                  <td className="p-3 text-right font-mono">{l.invoiceCents === null ? "—" : usd(l.invoiceCents, { exact: true })}</td>
                  <td className={`p-3 text-right font-mono ${bad ? "text-warn" : ""}`}>{l.diffCents > 0 ? "+" : ""}{usd(l.diffCents, { exact: true })}</td>
                  <td className={`p-3 ${r.cls}`}><span className="inline-flex items-center gap-1.5"><Icon name={r.icon} size={14} />{r.text}</span></td>
                </tr>
              );
            })}
            <tr className="font-medium">
              <td className="p-3 label-mono">Total</td>
              <td className="p-3 text-right font-mono text-[16px]">{usd(fc.quote.totalCents, { exact: true })}</td>
              <td className="p-3 text-right font-mono text-[16px]">{usd(fc.invoice.totalCents, { exact: true })}</td>
              <td className="p-3 text-right font-mono text-[16px] text-warn">{ex ? `+${usd(ex.deltaCents, { exact: true })}` : "$0.00"}</td>
              <td className="p-3 text-[13px] text-warn">{ex ? `${pct}% over commitment ${fc.commitmentId}` : ""}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4 text-[13px]">
          <p className="flex items-center gap-2 font-medium"><Icon name="cog" size={15} />Rule R-02 · deterministic</p>
          <p className="mt-2 font-mono text-[12px]">every invoice line ∈ approved quote lines</p>
          <p className="mt-1 font-mono text-[12px]">{fc.lineResults.filter((l) => l.invoiceLineId).map((l) => `${l.invoiceLineId} ${l.result === "match" ? "pass" : "FAIL"}`).join(" · ")}</p>
          <p className="mt-2 text-muted">Code checks the numbers in integer cents. The AI only writes the explanation. Policy {fc.policy.id} v{fc.policy.version}: {fc.policy.rule}</p>
        </Card>
        <Card className="p-4 text-[13px]">
          <p className="flex items-center gap-2 font-medium"><Icon name="pause" size={15} />Payment draft {fc.paymentDraft.id}</p>
          <p className="mt-2 font-mono text-[12px]">{usd(fc.paymentDraft.amountCents, { exact: true })} → {fc.paymentDraft.status.replace(/_/g, " ").toUpperCase()}</p>
          <p className="font-mono text-[12px]">requested by: Mela (agent)</p>
          <p className="mt-2 text-muted">Release needs an AP manager. No money moves in this demo — there is no “paid” state.</p>
        </Card>
        <Card className="p-4 text-[13px]">
          <p className="flex items-center gap-2 font-medium"><Icon name="file" size={15} />Evidence</p>
          <p className="mt-2 font-mono text-[12px]">{fc.quote.id} · approved by {fc.quote.approvedBy} {formatTime(fc.quote.approvedAt)}</p>
          <p className="font-mono text-[12px]">{fc.invoice.id} · received {formatTime(fc.invoice.receivedAt)}</p>
          <p className="mt-2 text-muted">Both documents are simulated. Quote lines come from {fc.quote.vendorName}&apos;s published prices; the invoice adds one line.</p>
        </Card>
      </div>

      {ex && (ex.status === "held" || ex.status === "waiting_vendor") ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4">
          <Icon name="lock" className="text-muted" />
          <p className="flex-1 text-[13px] text-muted">Separation of duties: Mela requested this payment, so Mela cannot approve it. Only an AP manager can.{ex.status === "waiting_vendor" && " Waiting on the vendor's explanation — you can still decide."}</p>
          <Button onClick={() => setDeciding(true)}>Review &amp; decide</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-ok/30 bg-ok-soft p-4 text-[14px] text-ok">
          <Icon name="check" />
          <p className="flex-1">{finalStatus(fc)}</p>
          <Button variant="secondary" onClick={onShowAudit}>View audit trail</Button>
          <Button onClick={() => go("summary")} iconRight="arrow">Return to the host</Button>
        </div>
      )}
      <DecisionDialog open={deciding} onClose={() => setDeciding(false)} fc={fc} />
    </div>
  );
}

export function finalStatus(fc: FinanceCase) {
  const d = fc.paymentDraft;
  if (d.status === "revised_unreleased") return `Line rejected. ${d.id} revised to ${usd(d.amountCents, { exact: true })} and still unreleased; a corrected invoice is requested. No payment was made.`;
  if (d.status === "released_for_manual_payment") return `Approved by a manager. ${d.id} (${usd(d.amountCents, { exact: true })}) is released for someone to pay outside Mela. Mela made no payment.`;
  return `${d.id} is held. No payment was made.`;
}

function DecisionDialog({ open, onClose, fc }: { open: boolean; onClose: () => void; fc: FinanceCase }) {
  const { decide, busy } = useMela();
  const [choice, setChoice] = useState<ManagerDecision["decision"]>("reject_line");
  const [reason, setReason] = useState("Not in the approved quote. Vendor must re-quote; the host approves any change.");
  const ex = fc.exception!;
  const opts: { v: ManagerDecision["decision"]; title: string; body: string }[] = [
    { v: "reject_line", title: `Reject the ${usd(ex.deltaCents)} line`, body: `Revise the draft to the approved ${usd(fc.quote.totalCents)}; keep it unreleased.` },
    { v: "ask_vendor", title: "Ask the vendor", body: "Keep everything held while the vendor explains." },
    { v: "approve_line", title: "Approve the extra line", body: `Release ${usd(fc.invoice.totalCents)} for manual payment outside Mela.` },
  ];
  return (
    <Dialog open={open} onClose={onClose} title={`Decide on ${ex.id}`} labelledBy="decide-h">
      <p className="text-[14px] text-muted">You&apos;re deciding as <strong>{fx.scenario.manager.name}</strong>, AP manager. Your decision and reason go in the audit trail.</p>
      <fieldset className="mt-4 space-y-2">
        <legend className="sr-only">Decision</legend>
        {opts.map((o) => (
          <label key={o.v} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${choice === o.v ? "border-primary bg-primary-soft" : "border-line"}`}>
            <input type="radio" name="decision" className="mt-1" checked={choice === o.v} onChange={() => setChoice(o.v)} />
            <span><span className="block font-medium">{o.title}</span><span className="text-[13px] text-muted">{o.body}</span></span>
          </label>
        ))}
      </fieldset>
      <label htmlFor="reason" className="mt-4 block text-[14px] font-medium">Reason (required)</label>
      <textarea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-app px-3 py-2 text-[14px]" aria-describedby="reason-hint" />
      <p id="reason-hint" className="text-[12px] text-faint">At least a few words. Mela can&apos;t record a decision for you.</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={reason.trim().length < 3} loading={busy === "decide"} onClick={async () => { if (await decide(choice, reason)) onClose(); }}>Record decision</Button>
      </div>
    </Dialog>
  );
}

function Audit({ fc }: { fc: FinanceCase }) {
  const { go } = useMela();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="label-mono">Audit trail · {fc.exception?.id ?? fc.invoice.id} · append-only</p>
          <h1 tabIndex={-1} className="mt-1 font-serif text-[32px] outline-none">Who did what, and why</h1>
        </div>
        <Badge kind="simulated">Simulated record</Badge>
      </div>
      <Card className="p-5">
        <ol className="space-y-4">
          {fc.audit.map((e) => (
            <li key={e.id} className="grid grid-cols-[72px_28px_minmax(0,1fr)] gap-3 text-[14px]">
              <span className="pt-0.5 font-mono text-[12px] text-faint">{new Date(e.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</span>
              <span className={`flex h-7 w-7 items-center justify-center rounded-full ${e.actor.kind === "human" ? "bg-[#2f4f6b] text-white" : e.actor.kind === "agent" ? "bg-primary-soft text-primary" : "bg-subtle text-muted"}`}>
                <Icon name={e.actor.kind === "human" ? "user" : e.actor.kind === "agent" ? "spark" : "cog"} size={14} />
              </span>
              <div>
                <p className="text-[12px] text-faint">{e.actor.name}{e.actor.role ? ` · ${e.actor.role.replace("_", " ")}` : ""}</p>
                <p>{e.action}</p>
                {e.detail && <p className="font-mono text-[12px] text-faint">{e.detail}</p>}
                {e.refs.length > 0 && <p className="font-mono text-[11px] text-faint">{e.refs.join(" · ")}</p>}
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <p className="text-[14px] text-muted">{finalStatus(fc)}</p>
      <Button iconRight="arrow" onClick={() => go("summary")}>Return to the host</Button>
    </div>
  );
}
