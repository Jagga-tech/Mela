import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExtractedFact } from "../../src/lib/research/contract";
import { failedSourceFacts, fillMissingFields, normalize, verifyFact, type FactCandidate } from "../../src/lib/research/verify";

const PAGE = `
# Special Event Permits

Applications must be submitted **at least 60 days** before the event.
The application fee is \\$85 and is non-refundable.
Applications should arrive two months
in advance for large events.

| Area | Capacity | Rental fee |
|---|---|---|
| Meadow | 150 | $1,500 |

Picnic areas hold 100–150 guests. See the [alcohol policy](https://sfrecpark.org/alcohol) for beer and wine.
The site is wheelchair accessible.
Caterers must be chosen from our approved vendor list.
`;

const candidate = (c: Partial<FactCandidate> & Pick<FactCandidate, "field">): FactCandidate => ({
  entityId: "golden-gate-park",
  appliesTo: ["golden-gate-park"],
  ...c,
});

const verify = (c: Partial<FactCandidate> & Pick<FactCandidate, "field">) => {
  const fact = verifyFact(PAGE, candidate(c), "src-1");
  ExtractedFact.parse(fact); // always matches the shared contract
  return fact;
};

describe("normalize", () => {
  it("lowercases, strips markdown and collapses whitespace", () => {
    assert.equal(normalize("**At  least**\n60 _days_"), "at least 60 days");
  });
  it("turns links into their text", () => {
    assert.equal(normalize("See the [alcohol policy](https://x.org/a) here"), "see the alcohol policy here");
  });
  it("flattens a table row", () => {
    assert.equal(normalize("| Meadow | 150 | $1,500 |"), "meadow 150 $1,500");
  });
  it("straightens typographic quotes and drops markdown escapes", () => {
    assert.equal(normalize("The park’s fee is \\$85"), "the park's fee is $85");
  });
});

describe("verifyFact", () => {
  it("exact: value appears literally in a quote that's on the page", () => {
    const f = verify({ field: "application_lead_days", value: 60, quote: "at least 60 days before the event" });
    assert.equal(f.state, "verified");
    assert.equal(f.confidence, "exact");
    assert.equal(f.value, 60);
    assert.equal(f.sourceId, "src-1");
  });

  it("exact: currency with an escaped dollar sign", () => {
    const f = verify({ field: "application_fee", value: 85, quote: "The application fee is $85" });
    assert.equal(f.confidence, "exact");
  });

  it("exact: a quote that spans a markdown table row", () => {
    const f = verify({ field: "capacity", value: 150, quote: "Meadow | 150" });
    assert.equal(f.state, "verified");
    assert.equal(f.confidence, "exact");
  });

  it("exact: a number with a thousands separator", () => {
    const f = verify({ field: "rental_fee", value: 1500, quote: "Meadow | 150 | $1,500" });
    assert.equal(f.confidence, "exact");
  });

  it("a quote that spans a line break still matches", () => {
    const f = verify({ field: "application_lead_days", value: 60, quote: "should arrive two months in advance" });
    assert.equal(f.state, "verified");
  });

  it("derived: a number written as words", () => {
    const f = verify({ field: "application_lead_days", value: 60, quote: "should arrive two months in advance" });
    assert.equal(f.confidence, "derived");
  });

  it("derived: a number picked from a range", () => {
    const f = verify({ field: "capacity", value: 150, quote: "Picnic areas hold 100–150 guests" });
    assert.equal(f.state, "verified");
    assert.equal(f.confidence, "derived");
  });

  it("derived: a boolean is always interpretation", () => {
    const f = verify({ field: "step_free_access", value: true, quote: "The site is wheelchair accessible." });
    assert.equal(f.confidence, "derived");
  });

  it("verifies the outside_catering field", () => {
    const f = verify({ field: "outside_catering", value: "approved_list_only", quote: "Caterers must be chosen from our approved vendor list." });
    assert.equal(f.state, "verified");
    assert.equal(f.confidence, "derived");
  });

  it("quote_mismatch: a paraphrase is downgraded, and the value is dropped", () => {
    const f = verify({ field: "application_lead_days", value: 60, quote: "Apply 60 days ahead of your event" });
    assert.equal(f.state, "unknown");
    assert.equal(f.unknownReason, "quote_mismatch");
    assert.equal(f.value, undefined);
    assert.equal(f.quote, undefined);
  });

  it("not_on_page: no quote, or no value", () => {
    assert.equal(verify({ field: "alcohol", value: true }).unknownReason, "not_on_page");
    assert.equal(verify({ field: "alcohol", quote: "beer and wine" }).unknownReason, "not_on_page");
    assert.equal(verify({ field: "alcohol", value: true, quote: "   " }).unknownReason, "not_on_page");
  });

  it("invalid_value: the wrong type for the field", () => {
    assert.equal(verify({ field: "capacity", value: "lots", quote: "Meadow | 150" }).unknownReason, "invalid_value");
    assert.equal(verify({ field: "capacity", value: -5, quote: "Meadow | 150" }).unknownReason, "invalid_value");
    assert.equal(verify({ field: "outside_catering", value: "maybe", quote: "approved vendor list" }).unknownReason, "invalid_value");
  });

  it("does not match a number inside a bigger number", () => {
    const f = verifyFact("Fee: $1,500 per day. Some other text that makes the page long enough.", candidate({ field: "rental_fee", value: 500, quote: "Fee: $1,500 per day" }), "s");
    assert.equal(f.confidence, "derived");
  });

  it("keeps appliesTo as given", () => {
    const f = verifyFact(PAGE, { entityId: "sf-rec-park", field: "application_fee", value: 85, quote: "application fee is $85", appliesTo: ["dolores", "ggp"] }, "s");
    assert.deepEqual(f.appliesTo, ["dolores", "ggp"]);
  });
});

describe("unknown helpers", () => {
  it("failedSourceFacts marks every field source_failed with no value", () => {
    const facts = failedSourceFacts("ggp", ["capacity", "alcohol"], "src-9", ["ggp"]);
    assert.equal(facts.length, 2);
    for (const f of facts) {
      ExtractedFact.parse(f);
      assert.equal(f.state, "unknown");
      assert.equal(f.unknownReason, "source_failed");
      assert.equal(f.value, undefined);
    }
  });

  it("fillMissingFields adds not_on_page for fields the extractor skipped", () => {
    const have = [verify({ field: "capacity", value: 150, quote: "Meadow | 150" })];
    const all = fillMissingFields(have, "golden-gate-park", ["capacity", "alcohol"], "src-1", ["golden-gate-park"]);
    assert.equal(all.length, 2);
    assert.equal(all[1]!.field, "alcohol");
    assert.equal(all[1]!.unknownReason, "not_on_page");
  });
});

describe("verifyFact: web app fields", () => {
  const CATERER = "Authentic Mexican catering for the Bay Area. Call (415) 555-0100. Indoor and outdoor service.";
  const check = (field: FactCandidate["field"], value: unknown, quote: string) =>
    verifyFact(CATERER, { entityId: "c1", field, value, quote, appliesTo: ["c1"] }, "s1");

  it("free text must appear word for word in the quote", () => {
    assert.equal(check("cuisine", "Mexican", "Authentic Mexican catering").confidence, "exact");
    const guessed = check("cuisine", "Latin American", "Authentic Mexican catering");
    assert.equal(guessed.state, "unknown");
    assert.equal(guessed.unknownReason, "quote_mismatch");
  });

  it("a phone number is compared digit for digit", () => {
    assert.equal(check("contact_phone", "415-555-0100", "Call (415) 555-0100.").state, "verified");
    assert.equal(check("contact_phone", "415-555-0199", "Call (415) 555-0100.").unknownReason, "quote_mismatch");
    assert.equal(check("contact_phone", "call us", "Call (415) 555-0100.").unknownReason, "invalid_value");
  });

  it("indoor_outdoor only takes its three values", () => {
    assert.equal(check("indoor_outdoor", "indoor and outdoor", "Indoor and outdoor service.").confidence, "exact");
    assert.equal(check("indoor_outdoor", "both", "Indoor and outdoor service.").unknownReason, "invalid_value");
  });
});
