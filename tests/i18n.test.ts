import { test } from "node:test";
import assert from "node:assert/strict";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { asLanguage, verbOf } from "../src/lib/i18n";
import { translate, translatorSpec } from "../src/agents/translator";
import { intakeSpec } from "../src/agents/intake";
import type { Send } from "../src/agents/harness";
import type { AuditEvent } from "../src/lib/types";

const reply = (text: string): Send => async () =>
  ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ text }) }] }) as unknown as BetaMessage;

test("asLanguage", () => {
  assert.equal(asLanguage("HI"), "hi");
  assert.equal(asLanguage(" vi "), "vi");
  assert.equal(asLanguage("xx"), "en");
  assert.equal(asLanguage(undefined), "en");
});

test("verbOf understands all four languages", () => {
  for (const b of ["हाँ 4821", "ਹਾਂਜੀ 4821", "có 4821", "đồng ý 4821", "YES 4821", "dong y 4821"]) assert.equal(verbOf(b), "YES", b);
  for (const b of ["không 4821", "nahi 4821", "NO 4821", "नहीं 4821"]) assert.equal(verbOf(b), "NO", b);
  assert.equal(verbOf("4821"), null);
  assert.equal(verbOf("maybe 4821"), null);
});

test("translate: en is unchanged and never calls send", async () => {
  let calls = 0;
  const send: Send = async (...a) => { calls++; return reply("?")(...a); };
  assert.equal(await translate("x", "en", [], send), "x");
  assert.equal(calls, 0);
});

test("translate caches identical requests", async () => {
  let calls = 0;
  const send: Send = async (...a) => { calls++; return reply("नमस्ते YES 4821")(...a); };
  const audit: AuditEvent[] = [];
  assert.equal(await translate("Hello YES 4821", "hi", audit, send), "नमस्ते YES 4821");
  assert.equal(await translate("Hello YES 4821", "hi", audit, send), "नमस्ते YES 4821");
  assert.equal(calls, 1);
});

test("translate failure returns the English text and audits translate_failed", async () => {
  const audit: AuditEvent[] = [];
  const send: Send = async () => { throw new Error("boom"); };
  assert.equal(await translate("Reply YES 1234", "pa", audit, send), "Reply YES 1234");
  assert.ok(audit.some((a) => a.action === "translate_failed"));
});

test("translate re-inserts dropped YES/NO code tokens", async () => {
  const out = await translate("Reply YES 4821 or NO 4821", "vi", [], reply("Trả lời có hoặc không"));
  assert.equal(out, "Trả lời có hoặc không (YES 4821 / NO 4821)");
});

test("translate timeout returns the English text and audits translate_failed", async () => {
  const audit: AuditEvent[] = [];
  const hang: Send = () => new Promise(() => {});
  assert.equal(await translate("Reply YES 9999 later", "vi", audit, hang, 10), "Reply YES 9999 later");
  assert.ok(audit.some((a) => a.action === "translate_failed" && /timeout/.test(a.detail ?? "")));
});

test("translator output cap is 1500 characters", () => {
  assert.ok(translatorSpec.output.safeParse({ text: "a".repeat(1500) }).success);
  assert.ok(!translatorSpec.output.safeParse({ text: "a".repeat(1501) }).success);
});

test("intake maps an unexpected language code to en instead of failing", () => {
  const out = intakeSpec.output.parse({ brief: { eventType: "", location: "", dateWindow: null, guestCount: null, budgetUsd: null,
    accessibility: [], dietary: [], preferences: [] }, missing: [], changes: [], language: "es" });
  assert.equal(out.language, "en");
});
