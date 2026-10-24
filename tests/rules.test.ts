import { test } from "node:test"; import assert from "node:assert/strict";
import { checkFit, amountToPayCents, budgetCheck } from "@/lib/rules";
import type { EventBrief, Vendor, VendorQuote, QuoteExtract } from "@/lib/types";

const brief = (o: Partial<EventBrief> = {}): EventBrief => ({ eventType: "party", location: "SF", dateWindow: null,
  guestCount: 110, budgetUsd: 12000, accessibility: ["step-free"], dietary: ["vegetarian"], preferences: [], ...o });
const venue = (o: Partial<Vendor> = {}): Vendor => ({ id: "v", name: "V", category: "venue", phone: "1",
  capacity: 120, priceHintUsd: null, accessibility: ["step-free"], dietary: [], ...o });
const ex = (o: Partial<QuoteExtract> = {}): QuoteExtract => ({ available: true, priceUsd: null, depositUsd: null,
  terms: [], evidence: [], openQuestions: [], ...o });
const q = (id: string, priceUsd: number | null): VendorQuote => ({ vendorId: id, callId: "c", extract: ex({ priceUsd }), createdAt: "" });

test("checkFit fit / conflict / possible", () => {
  assert.deepEqual(checkFit(brief(), venue()), { fit: "fit", conflicts: [], unknowns: [] });
  const c = checkFit(brief(), venue({ capacity: 80 }));
  assert.equal(c.fit, "conflict"); assert.deepEqual(c.conflicts, ["capacity 80 is below 110 guests"]);
  const p = checkFit(brief(), venue({ capacity: null }));
  assert.equal(p.fit, "possible"); assert.deepEqual(p.unknowns, ["capacity unknown"]);
});

test("checkFit accessibility (venue) and dietary (catering) only", () => {
  assert.deepEqual(checkFit(brief(), venue({ accessibility: [] })).conflicts, ["no step-free access"]);
  assert.deepEqual(checkFit(brief(), venue({ category: "catering", accessibility: [] })).conflicts, ["no vegetarian option"]);
  assert.deepEqual(checkFit(brief(), venue({ category: "decor", accessibility: [] })).conflicts, []);
});

test("checkFit null guestCount is unknown, not zero", () => {
  const r = checkFit(brief({ guestCount: null }), venue());
  assert.equal(r.fit, "possible"); assert.deepEqual(r.unknowns, ["guest count unknown"]);
});

test("amountToPayCents", () => {
  assert.equal(amountToPayCents(ex({ depositUsd: 500, priceUsd: 1800 })), 50000);
  assert.equal(amountToPayCents(ex({ priceUsd: 900 })), 90000);
  assert.equal(amountToPayCents(ex()), null);
});

test("budgetCheck", () => {
  const r = budgetCheck(brief(), [q("a", 1800), q("b", 4950), q("c", 900)]);
  assert.deepEqual(r, { totalCents: 765000, unknownVendorIds: [], budgetCents: 1200000, overByCents: 0 });
  const u = budgetCheck(brief(), [q("a", 1800), q("b", null)]);
  assert.deepEqual([u.totalCents, u.unknownVendorIds], [180000, ["b"]]);
  assert.equal(budgetCheck(brief({ budgetUsd: null }), [q("a", 1)]).overByCents, null);
  assert.equal(budgetCheck(brief({ budgetUsd: 1000 }), [q("a", 1800)]).overByCents, 80000);
});

test("checkFit tolerates phrasing drift between brief and vendor tags", () => {
  assert.deepEqual(checkFit(brief({ accessibility: ["step-free access"] }), venue({ accessibility: ["step-free"] })), { fit: "fit", conflicts: [], unknowns: [] });
  assert.deepEqual(checkFit(brief({ dietary: ["vegetarian"] }), venue({ category: "catering", accessibility: [], dietary: ["vegetarian options", "halal"] })).conflicts, []);
});
