import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureDisclosure, DISCLOSURE } from "../src/agents/outreach";
import type { CallScript } from "../src/lib/types";

const script: CallScript = { opening: "Hello", questions: ["q"], closing: "bye", mustNotAgreeTo: [] };

test("ensureDisclosure", () => {
  const r = ensureDisclosure(script);
  assert.equal(r.opening, `${DISCLOSURE} Hello`);
  assert.deepEqual(r.mustNotAgreeTo, ["prices", "dates", "deposits", "terms"]);
  const ok = { ...script, opening: `${DISCLOSURE} Hello` };
  assert.equal(ensureDisclosure(ok).opening, ok.opening);
  const mid = { ...script, opening: `Hey. ${DISCLOSURE} Hello`, mustNotAgreeTo: ["prices", "refunds"] };
  const m = ensureDisclosure(mid);
  assert.equal(m.opening, mid.opening);
  assert.deepEqual(m.mustNotAgreeTo, ["prices", "refunds", "dates", "deposits", "terms"]);
  assert.equal(ensureDisclosure({ ...script, opening: "" }).opening, DISCLOSURE);
});
