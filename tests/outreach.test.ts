import { test } from "node:test";
import assert from "node:assert/strict";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { buildCallScript, ensureDisclosure, DISCLOSURE } from "../src/agents/outreach";
import type { Send } from "../src/agents/harness";
import { DISCLOSURES } from "../src/lib/i18n";
import type { CallScript, EventBrief, Vendor } from "../src/lib/types";

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

test("scripts are English-native: a Hindi vendor still gets an English script request", async () => {
  let input = "";
  const send: Send = async (params) => {
    input = params.messages[0].content;
    return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(script) }] } as unknown as BetaMessage;
  };
  const vendor = { id: "v", name: "Flor", category: "decor", language: "hi" } as unknown as Vendor;
  const r = await buildCallScript(vendor, {} as EventBrief, ["Free on May 3?"], [], send);
  assert.ok(r.ok);
  assert.ok(input.includes("Free on May 3?"));
  assert.ok(!input.includes("Hindi") && !input.includes("Write the whole script"), input);
  assert.ok(r.data.opening.startsWith(DISCLOSURES.en));
});

test("ensureDisclosure ignores any language argument and uses the English line", () => {
  assert.equal(DISCLOSURE, DISCLOSURES.en);
  assert.ok((ensureDisclosure as (s: CallScript, lang: string) => CallScript)(script, "hi").opening.startsWith(DISCLOSURES.en));
});
