import { test } from "node:test";
import assert from "node:assert/strict";
import { openedWithDisclosure, outcomeFromTranscript, pairAnswers, spokenDollars, vendorSaid, type Turn } from "../../src/lib/calls/outcome";
import { buildCallPlan, DISCLOSURE } from "../../src/mela/domain/calls";
import * as fx from "../../src/mela/fixtures/oakland-baby-shower";
import { demoBrief } from "../mela-helpers";

const plan = buildCallPlan({ brief: demoBrief(), vendor: fx.vendors[0]!, phoneNumber: "+15105550142", numberSource: { label: "role-play" }, rolePlay: true });
const m = (text: string): Turn => ({ speaker: "mela", text });
const v = (text: string): Turn => ({ speaker: "vendor", text });

test("answers are the vendor's words after each question; paraphrased or skipped questions are not answered", () => {
  const t = [m(DISCLOSURE), v("Sure."), m(plan.questions[0]!), v("Yes, we're open"), v("that day."), m("So, um, anything else?"), v("No.")];
  const a = pairAnswers(plan, t);
  assert.equal(a[0], "Yes, we're open that day.");
  assert.ok(a.slice(1).every((x) => x === null));
});

test("a mid-sentence question still matches when Mela adds a lead-in", () => {
  const t = [m(DISCLOSURE), m(`Great, thanks. ${plan.questions[1]}`), v("Yes, outside caterers are fine.")];
  assert.equal(pairAnswers(plan, t)[1], "Yes, outside caterers are fine.");
});

test("vendorSaid only accepts text the vendor actually said", () => {
  const t = [m("What is the fee?"), v("It's  $1,200 for the evening.")];
  assert.ok(vendorSaid("it's $1,200 for the evening", t));
  assert.ok(!vendorSaid("What is the fee?", t));
  assert.ok(!vendorSaid("It's about twelve hundred", t));
});

test("disclosure must be Mela's first turn", () => {
  assert.ok(openedWithDisclosure(plan, [v("Hello?"), m(DISCLOSURE)]));
  assert.ok(!openedWithDisclosure(plan, [m("Hi there!"), m(DISCLOSURE)]));
  assert.ok(!openedWithDisclosure(plan, []));
});

test("spoken prices: one clear amount only", () => {
  assert.equal(spokenDollars("It's $1,250 for the day"), 125000);
  assert.equal(spokenDollars("1200 dollars flat"), 120000);
  assert.equal(spokenDollars("$900 to $1,200 depending"), null);
  assert.equal(spokenDollars("$900 plus a $200 cleaning fee"), null);
  assert.equal(spokenDollars("about twelve hundred"), null);
  assert.equal(spokenDollars(null), null);
});

test("an outcome can never be booked, even if the vendor says so", () => {
  const o = outcomeFromTranscript("call_1", plan, [m(DISCLOSURE), m(plan.questions[0]!), v("It's booked, you're all set, confirmed in writing.")]);
  assert.notEqual(o.availability, "booked");
  assert.notEqual(o.availability, "written_confirmation");
});
