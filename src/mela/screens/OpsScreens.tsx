"use client";
// P10 Handoff (96:1920) · P11 Exception (97:1835) · P12 Decision (97:2033) · P13 Audit (98:2049).
// Mela Events is the planning business; this is its AP seat, not the host's planning view.
import { useState } from "react";
import type { FinanceCase, ManagerDecision } from "../contracts";
import { formatTime, usd } from "../domain/util";
import { useMela } from "../state/MelaProvider";
import { MelaOrb } from "../ui/MelaOrb";
import { ActionBar, Badge, Button, Card, Dialog, Disclosure, Icon, Note, PageHeader } from "../ui/primitives";
import * as fx from "../fixtures/oakland-baby-shower";

export function HandoffScreen() {
  const { state, openFinance, busy, go } = useMela();
  const venue = state.research?.vendors.find((v) => v.id === state.selected.venue);
  return (
    <div className="anim-handoff mx-auto max-w-[680px] space-y-6 pt-2">
      <MelaOrb state="handoff" size={60} />
      <PageHeader eyebrow="Role switch" title="From the host to Mela Events operations"
        lede={`The host chose ${venue?.name ?? "a venue"} and asked questions. Nothing was booked or paid. Now the planning business checks every invoice against the approved quote before anyone pays.`} />
      <Note tone="sim" icon="file">
        <p className="font-medium">This part is a simulated record.</p>
        <p className="mt-0.5">It assumes {venue?.name ?? "the venue"} later sent a written quote built from its published prices, the host approved it, and an invoice arrived. The R-02 matching rule and the approval gate run in code. No Hyphenate API is called and no money moves.</p>
      </Note>
      <div className="flex flex-wrap gap-2">
        <Button size="lg" iconRight="arrow" loading={busy === "finance"} onClick={openFinance}>Open the AP inbox as {fx.scenario.manager.name.split(" ")[0]}</Button>
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
  const [auditOpen, setAuditOpen] = useState(false);
  if (!fc) return null;
  return (
    <div className="mx-auto max-w-[880px] space-y-6">
      <Exception fc={fc} onShowAudit={() => { setAuditOpen(true); requestAnimationFrame(() => document.getElementById("audit")?.scrollIntoView({ behavior: "smooth", block: "start" })); }} />
      <Audit fc={fc} open={auditOpen} onToggle={setAuditOpen} />
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
  const open = !!ex && (ex.status === "held" || ex.status === "waiting_vendor");
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Exception ${ex?.id ?? "—"} · invoice ${fc.invoice.id} · quote ${fc.quote.id}`}
        title={ex ? `${fc.quote.vendorName} billed ${usd(ex.deltaCents)} more than the host approved` : `${fc.invoice.id} matches the approved quote`}
        aside={<Badge kind="simulated" title={fc.origin.label}>Simulated record</Badge>} />

      {ex && (
        <Card className="flex items-start gap-4 p-4 sm:p-5">
          <MelaOrb state={decided ? "succeeded" : "caution"} size={44} />
          <p className="min-w-0 text-[15px] leading-7 sm:text-[16px]">
            {decided
              ? <><span className="font-medium">{decided.actor.name} decided: {decided.decision.replace("_", " ")}.</span> “{decided.reason}”</>
              : <>I held payment draft {fc.paymentDraft.id}. {failing.map((l) => `“${l.label}” (${usd(l.diffCents, { exact: true })})`).join(", ")} isn&apos;t in quote {fc.quote.id}, which the host approved for {usd(fc.quote.totalCents, { exact: true })}. I&apos;m not allowed to approve this. It needs you.</>}
          </p>
        </Card>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-[14px]">
          <caption className="sr-only">Invoice lines checked against the approved quote with rule R-02</caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="label-mono p-3 font-semibold sm:px-4">Line</th>
              <th scope="col" className="label-mono p-3 text-right font-semibold">Quote</th>
              <th scope="col" className="label-mono p-3 text-right font-semibold sm:px-4">Invoice</th>
            </tr>
          </thead>
          <tbody>
            {fc.lineResults.map((l) => {
              const bad = l.result === "not_in_quote" || l.result === "amount_differs";
              const r = RESULT[l.result];
              return (
                <tr key={(l.invoiceLineId ?? "") + (l.quoteLineId ?? "")} className={`border-b border-line align-top ${bad ? "anim-emphasis bg-warn-soft" : ""}`}>
                  <td className={`p-3 sm:px-4 ${bad ? "border-l-[3px] border-l-warn" : ""}`}>
                    <span className="block">{l.label} <span className="text-faint">{l.invoiceLineId ?? l.quoteLineId}</span></span>
                    <span className={`mt-0.5 inline-flex items-center gap-1 text-[13px] ${r.cls}`}><Icon name={r.icon} size={13} />{r.text}{bad && ` · +${usd(l.diffCents, { exact: true })}`}</span>
                  </td>
                  <td className="p-3 text-right font-mono text-[13px] sm:text-[14px]">{l.quoteCents === null ? "—" : usd(l.quoteCents, { exact: true })}</td>
                  <td className="p-3 text-right font-mono text-[13px] sm:px-4 sm:text-[14px]">{l.invoiceCents === null ? "—" : usd(l.invoiceCents, { exact: true })}</td>
                </tr>
              );
            })}
            <tr className="font-medium">
              <td className="p-3 sm:px-4">Total{ex && <span className="block text-[13px] font-normal text-warn">+{usd(ex.deltaCents, { exact: true })} · {pct}% over commitment {fc.commitmentId}</span>}</td>
              <td className="p-3 text-right font-mono">{usd(fc.quote.totalCents, { exact: true })}</td>
              <td className="p-3 text-right font-mono sm:px-4">{usd(fc.invoice.totalCents, { exact: true })}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-surface/60 p-4 ring-1 ring-line">
          <p className="flex items-center gap-2 text-[14px] font-medium"><Icon name="cog" size={15} />Rule R-02</p>
          <p className="t-small mt-1">Every invoice line must be in the approved quote. Code checks it in integer cents.</p>
          <p className="mt-2 font-mono text-[12px] text-muted">{fc.lineResults.filter((l) => l.invoiceLineId).map((l) => `${l.invoiceLineId} ${l.result === "match" ? "pass" : "FAIL"}`).join(" · ")}</p>
        </div>
        <div className={`rounded-2xl p-4 ring-1 ${fc.paymentDraft.status === "held" ? "bg-held-soft/60 ring-held/25" : "bg-surface/60 ring-line"}`}>
          <p className="flex items-center gap-2 text-[14px] font-medium"><Icon name="pause" size={15} />Payment draft {fc.paymentDraft.id}</p>
          <p className="mt-1 text-[15px]"><span className="font-mono">{usd(fc.paymentDraft.amountCents, { exact: true })}</span> · <span className="font-medium">{fc.paymentDraft.status.replace(/_/g, " ")}</span></p>
          <p className="t-small mt-1">Requested by Mela (agent). Release needs an AP manager. There is no “paid” state.</p>
        </div>
      </div>

      <Disclosure summary="How this was checked" meta="Policy, evidence">
        <div className="t-small space-y-2">
          <p>Policy {fc.policy.id} v{fc.policy.version}: {fc.policy.rule}</p>
          <p>The AI only writes the explanation. The numbers and the hold come from code.</p>
          <p className="font-mono text-[12px]">{fc.quote.id} · approved by {fc.quote.approvedBy} {formatTime(fc.quote.approvedAt)}<br />{fc.invoice.id} · received {formatTime(fc.invoice.receivedAt)}</p>
          <p>Both documents are simulated. Quote lines come from {fc.quote.vendorName}&apos;s published prices; the invoice adds one line.</p>
        </div>
      </Disclosure>

      {open ? (
        <ActionBar note={<span className="flex items-start gap-2"><Icon name="lock" size={15} className="mt-0.5 shrink-0" />Mela requested this payment, so Mela cannot approve it. Only an AP manager can.{ex!.status === "waiting_vendor" && " Waiting on the vendor's explanation; you can still decide."}</span>}>
          <Button size="lg" onClick={() => setDeciding(true)}>Review &amp; decide</Button>
        </ActionBar>
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl bg-ok-soft p-4 text-ok sm:flex-row sm:items-center">
          <p className="flex flex-1 items-start gap-2 text-[15px]"><Icon name="check" className="mt-1 shrink-0" />{finalStatus(fc)}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onShowAudit}>View audit trail</Button>
            <Button onClick={() => go("summary")} iconRight="arrow">Return to the host</Button>
          </div>
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
          <label key={o.v} className={`flex cursor-pointer gap-3 rounded-xl p-3 ring-1 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${choice === o.v ? "bg-primary-soft ring-primary/50" : "ring-line"}`}>
            <input type="radio" name="decision" className="mt-1" checked={choice === o.v} onChange={() => setChoice(o.v)} />
            <span><span className="block font-medium">{o.title}</span><span className="text-[13px] text-muted">{o.body}</span></span>
          </label>
        ))}
      </fieldset>
      <label htmlFor="reason" className="mt-4 block text-[14px] font-medium">Reason (required)</label>
      <textarea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-xl bg-surface px-3 py-2 text-[16px] ring-1 ring-line-strong" aria-describedby="reason-hint" />
      <p id="reason-hint" className="text-[12px] text-faint">At least a few words. Mela can&apos;t record a decision for you.</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={reason.trim().length < 3} loading={busy === "decide"} onClick={async () => { if (await decide(choice, reason)) onClose(); }}>Record decision</Button>
      </div>
    </Dialog>
  );
}

function Audit({ fc, open, onToggle }: { fc: FinanceCase; open: boolean; onToggle: (o: boolean) => void }) {
  return (
    <section id="audit" aria-labelledby="audit-h" className="scroll-mt-24">
      <Disclosure open={open} onToggle={onToggle}
        summary={<span id="audit-h">Audit trail <span className="font-normal text-faint">· append-only · who did what, and why</span></span>}
        meta={`${fc.audit.length} events`}>
        <ol className="space-y-4">
          {fc.audit.map((e) => (
            <li key={e.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 text-[14px]">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full ${e.actor.kind === "human" ? "bg-research text-white" : e.actor.kind === "agent" ? "bg-primary-soft text-primary" : "bg-subtle text-muted"}`} aria-hidden>
                <Icon name={e.actor.kind === "human" ? "user" : e.actor.kind === "agent" ? "spark" : "cog"} size={14} />
              </span>
              <div className="min-w-0">
                <p className="text-[12px] text-faint">
                  <span className="font-mono">{new Date(e.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</span>
                  {" · "}{e.actor.name}{e.actor.role ? ` · ${e.actor.role.replace("_", " ")}` : ""} <span className="sr-only">({e.actor.kind})</span>
                </p>
                <p>{e.action}</p>
                {e.detail && <p className="break-words font-mono text-[12px] text-faint">{e.detail}</p>}
                {e.refs.length > 0 && <p className="break-words font-mono text-[11px] text-faint">{e.refs.join(" · ")}</p>}
              </div>
            </li>
          ))}
        </ol>
        <p className="t-small mt-4 border-t border-line pt-3">Simulated record. {finalStatus(fc)}</p>
      </Disclosure>
    </section>
  );
}
