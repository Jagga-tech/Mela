import { test } from "node:test";
import assert from "node:assert/strict";
import { answerQuestion, applyParsed, confirmBrief, confirmationBlockers, editBrief, emptyBrief, parseIntakeText, questionsFor, setRequirementPriority } from "../src/mela/domain/intake";
import { fromAgentBrief, toAgentBrief } from "../src/mela/adapters/agentBrief";
import { scenario } from "../src/mela/fixtures/oakland-baby-shower";

const fromText = (t: string) => applyParsed(emptyBrief(), parseIntakeText(t)).brief;
const pri = (b: ReturnType<typeof fromText>, key: string) => b.requirements.find((r) => r.key === key)?.priority;

test("text intake builds the brief from the host's own words", () => {
  const b = fromText(scenario.exampleText);
  assert.equal(b.occasion, "baby shower");
  assert.equal(b.city, "Oakland");
  assert.deepEqual(b.guestRange, { min: 75, max: 100 });
  assert.equal(b.dateTarget, "2027-01-17");
  assert.deepEqual(b.budget, { amountCents: 200000, scope: "unset" });
  for (const k of ["bathrooms", "climate_control", "outside_catering", "alcohol_allowed", "cuisine", "meat_options", "vegetarian_options"]) assert.equal(pri(b, k), "MUST_HAVE", k);
  assert.equal(pri(b, "style"), "PREFERENCE");
  assert.equal(pri(b, "indoor_outdoor"), "FLEXIBLE");
  assert.equal(b.requirements.find((r) => r.key === "cuisine")?.value, "Mexican");
});

test("intake never infers needs the host didn't state", () => {
  const b = fromText(scenario.exampleText);
  assert.equal(b.requirements.some((r) => r.key === "step_free_access"), false);
  assert.equal(b.hostName, undefined);
  assert.equal(b.atmosphere, undefined);
  // capacity follows from guests, but its priority is the host's call
  assert.equal(pri(b, "capacity"), "UNSET");
});

test("missing fields become one question each; $2,000 scope is asked, not assumed", () => {
  const b = fromText(scenario.exampleText);
  const q = questionsFor(b);
  assert.equal(q.length, 1);
  assert.equal(q[0].field, "budget.scope");
  const answered = answerQuestion(b, q[0], "venue_only").brief;
  assert.equal(answered.budget.scope, "venue_only");
  assert.equal(answered.requirements.find((r) => r.key === "venue_budget")?.value, 200000);
  assert.deepEqual(questionsFor(answered), []);
  const sparse = fromText("a birthday party");
  assert.deepEqual(questionsFor(sparse).map((x) => x.field), ["city", "dateTarget", "guestRange", "budget.amountCents"]);
});

test("a date without a year is asked about, not guessed", () => {
  assert.equal(fromText("baby shower in Oakland on January 17 for 80 guests").dateTarget, null);
});

test("confirmation is blocked until every requirement has a priority", () => {
  let b = answerQuestion(fromText(scenario.exampleText), null, "the budget is for the venue only").brief;
  assert.equal(b.budget.scope, "venue_only");
  assert.throws(() => confirmBrief(b), /not ready/);
  assert.match(confirmationBlockers(b).join(" "), /fits 100 guests/i);
  b = setRequirementPriority(b, "capacity", "MUST_HAVE");
  b = setRequirementPriority(b, "venue_budget", "MUST_HAVE");
  const c = confirmBrief(b);
  assert.ok(c.confirmedAt);
});

test("edits persist, bump the version and un-confirm the brief", () => {
  let b = answerQuestion(fromText(scenario.exampleText), null, "venue only").brief;
  b = setRequirementPriority(setRequirementPriority(b, "capacity", "MUST_HAVE"), "venue_budget", "MUST_HAVE");
  const confirmed = confirmBrief(b);
  const edited = editBrief(confirmed, { guestRange: { min: 80, max: 110 } });
  assert.equal(edited.version, confirmed.version + 1);
  assert.equal(edited.confirmedAt, null);
  assert.equal(edited.requirements.find((r) => r.key === "capacity")?.value, 110);
  assert.equal(edited.requirements.find((r) => r.key === "capacity")?.priority, "MUST_HAVE");
});

test("agent brief mapping keeps web-only fields and maps labels to keys", () => {
  const web = answerQuestion(fromText(scenario.exampleText), null, "venue only").brief;
  const agent = toAgentBrief(web);
  assert.equal(agent.guestCount, 100);
  assert.equal(agent.budgetUsd, 2000);
  const back = fromAgentBrief({ ...agent, preferences: [...agent.preferences, { label: "bathrooms", priority: "must-have" }, { label: "photo booth", priority: "preferred" }] }, web).brief;
  assert.deepEqual(back.guestRange, { min: 75, max: 100 });
  assert.equal(back.budget.scope, "venue_only");
  assert.equal(back.requirements.filter((r) => r.key === "bathrooms").length, 1);
  assert.equal(back.requirements.find((r) => r.label === "Photo booth")?.priority, "PREFERENCE");
});
