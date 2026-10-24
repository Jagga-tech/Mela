import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildFinanceCase, evaluateInvoice, MELA_AP_AGENT, recordManagerDecision } from "../src/mela/domain/finance";
import { demoAdapter } from "../src/mela/adapters/demo";
import * as fx from "../src/mela/fixtures/oakland-baby-shower";
import { FinanceCase, PaymentDraft } from "../src/mela/contracts";
import { demoBrief } from "./mela-helpers";

const origin = { mode: "demo" as const, provider: "rules", label: "test" };
const rosa = fx.scenario.manager;

async function demoCase() {
  const svc = demoAdapter();
  const s = await svc.startResearch(demoBrief());
  const snap = await svc.getResearch({ ...s.job, startedAt: new Date(Date.now() - 60_000).toISOString() }, demoBrief());
  return svc.openFinanceCase({ brief: demoBrief(), venue: fx.vendors[0], snapshot: snap });
}

test("R-02 and P-1 match the expected results recorded in docs/fixtures/finance-fixtures.json", () => {
  const f = JSON.parse(readFileSync("docs/fixtures/finance-fixtures.json", "utf8"));
  for (const inv of f.invoices) {
    const quote = f.quotes.find((q: { id: string }) => q.id === inv.quoteId);
    for (const v of [1, 2] as const) {
      const policy = f.policies.find((p: { version: number }) => p.version === v);
      const r = evaluateInvoice(quote, inv, policy);
      assert.equal(r.outcome, inv.expected[`v${v}`], `${inv.id} v${v}`);
      assert.deepEqual(r.failingLineIds, inv.expected.failingLines);
      assert.equal(r.deltaCents, inv.expected.deltaCents);
    }
  }
});

test("the demo invoice discrepancy is exact: $1,250 quote, $1,400 invoice, $150 held", async () => {
  const fc = await demoCase();
  FinanceCase.parse(fc);
  assert.equal(fc.quote.totalCents, 125000);
  assert.equal(fc.invoice.totalCents, 140000);
  assert.equal(fc.exception?.deltaCents, 15000);
  assert.deepEqual(fc.exception?.failingLineIds, ["L3"]);
  assert.equal(fc.outcome, "held");
  assert.equal(fc.paymentDraft.status, "held");
  assert.equal(fc.origin.mode, "demo");
});

test("amount drift on a quoted line is caught too, in integer cents", () => {
  const quote = { id: "Q", vendorId: "v", vendorName: "V", totalCents: 30000, lines: [{ id: "L1", label: "a", qty: 3, unitCents: 10000, totalCents: 30000 }] };
  const r = evaluateInvoice(quote, { id: "I", quoteId: "Q", totalCents: 30001, lines: [{ id: "L1", label: "a", totalCents: 30001, quoteLineId: "L1" }] }, fx.finance.policy);
  assert.equal(r.outcome, "held");
  assert.equal(r.deltaCents, 1);
  const mismatch = evaluateInvoice(quote, { id: "I", quoteId: "Q", totalCents: 99999, lines: [{ id: "L1", label: "a", totalCents: 30000, quoteLineId: "L1" }] }, fx.finance.policy);
  assert.equal(mismatch.outcome, "held"); // invoice total disagrees with its own lines
});

test("held exceptions can't be approved silently, by the agent, or without a reason", async () => {
  const fc = await demoCase();
  assert.throws(() => recordManagerDecision(fc, { decision: "approve_line", reason: "looks fine", actor: MELA_AP_AGENT }), /Only a human AP manager/);
  assert.throws(() => recordManagerDecision(fc, { decision: "approve_line", reason: "  ", actor: rosa }), /written reason/);
  assert.throws(() => recordManagerDecision(fc, { decision: "approve_line", reason: "ok ok", actor: { ...rosa, id: fc.paymentDraft.requestedBy } }), /Separation of duties/);
  await assert.rejects(demoAdapter().decideFinance(fc, { decision: "approve_line", reason: "fine", actor: MELA_AP_AGENT }), /Only a human/);
  assert.equal(fc.exception?.status, "held");
});

test("a manager decision is recorded with audit events and never pays", async () => {
  const fc = await demoCase();
  const before = fc.audit.length;
  const next = recordManagerDecision(fc, { decision: "reject_line", reason: "Not in the approved quote. Vendor must re-quote.", actor: rosa });
  assert.equal(next.exception?.status, "resolved_rejected");
  assert.equal(next.paymentDraft.amountCents, 125000);
  assert.equal(next.paymentDraft.status, "revised_unreleased");
  assert.equal(next.decisions.length, 1);
  assert.equal(next.audit.length, before + 2);
  assert.equal(next.audit.at(-2)?.actor.id, rosa.id);
  assert.throws(() => recordManagerDecision(next, { decision: "approve_line", reason: "again", actor: rosa }), /no open exception/);
  assert.equal(fc.exception?.status, "held", "the input case is not mutated");
  assert.equal(PaymentDraft.shape.status.options.includes("paid" as never), false);
  assert.equal(next.paymentDraft.simulated, true);
});

test("asking the vendor keeps the payment held", async () => {
  const fc = await demoCase();
  const next = recordManagerDecision(fc, { decision: "ask_vendor", reason: "Please explain the setup fee.", actor: rosa });
  assert.equal(next.exception?.status, "waiting_vendor");
  assert.equal(next.paymentDraft.status, "held");
});

test("a clean invoice matches without an exception", () => {
  const quote = { id: "Q", vendorId: "v", vendorName: "V", totalCents: 100, lines: [{ id: "L1", label: "a", qty: 1, unitCents: 100, totalCents: 100 }] };
  const fc = buildFinanceCase({ eventLabel: "e", quote, commitmentId: "C", invoice: { id: "INV-1", quoteId: "Q", totalCents: 100, lines: [{ id: "L1", label: "a", totalCents: 100, quoteLineId: "L1" }] }, policy: fx.finance.policy, origin });
  assert.equal(fc.outcome, "matched");
  assert.equal(fc.exception, null);
});
