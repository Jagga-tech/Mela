# Multilingual Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hosts and vendors can speak and text in English, Hindi, Punjabi or Vietnamese. Calls go through a Cartesia agent configured for that language, texts are translated before sending, call scripts are written in the callee's language, and YES/NO replies are understood in all four languages. The 4-digit code stays the gate.

**Architecture:** One small module `src/lib/i18n.ts` owns the language list, display names, YES/NO vocabularies, per-language disclosure lines, and a cached `translate()` that calls Claude only for non-English. Language is data: `Event.language` (from Intake or the form) and `Vendor.language` (seed). The one text-sending helper translates by recipient language. Cartesia gets one managed agent per language, chosen by the callee's language at call time. Internal state, prompts, rules and the audit log stay English.

**Tech Stack:** as the main plan. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-agent-demo-flow-design.md`; this plan extends the Channels and Approvals sections.

## Global Constraints

- Worktree `/Users/chanpreetsingh/Mela-final-fixes`, branch `agent-demo-flow-final-fixes`. Commit by explicit path; messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Languages: exactly `["en","hi","pa","vi"]` (ISO 639-1), names English, Hindi, Punjabi, Vietnamese. Unknown or missing → `"en"`.
- Translation never blocks a gate: on any failure the English text is sent. Numbers, 4-digit codes, phone numbers, currency amounts, names and the literal tokens `YES`/`NO` are preserved verbatim in translations.
- `parseReply` tokenises with Unicode letters and digits (`/[^\p{L}\p{N}]+/u`), NFC-normalises, and accepts the YES/NO vocabularies below plus ASCII `YES`/`NO`; the code is still a 4-digit ASCII token. Only the host's number can approve, unchanged.
- YES words: en `yes, y, ok, okay, approve, confirm`; hi `haan, han, haanji, ji, theek, हाँ, हां, जी, ठीक`; pa `haan, haanji, hanji, ਹਾਂ, ਹਾਂਜੀ, ਠੀਕ`; vi `có, co, vâng, vang, đồng ý, dong y, duoc, được`. NO words: en `no, n, decline, cancel`; hi `nahi, nahin, na, नहीं, ना`; pa `nahi, ਨਹੀਂ, ਨਾ`; vi `không, khong`. Multi-word entries match on the first word(s) of the reply.
- Disclosure lines per language are fixed constants (not translated at runtime) with the same meaning as the English `DISCLOSURE`; the implementer writes them and marks them `// ponytail: native-speaker check pending`.
- Cartesia: one agent per language named `mela-caller-<lang>`, `config.language.primary = <lang>`, instructions say to speak only that language; env `CARTESIA_AGENT_ID_<LANG>` (upper-case) per language, with `CARTESIA_AGENT_ID` as the English fallback; voice id `CARTESIA_VOICE_ID_<LANG>` ?? `CARTESIA_VOICE_ID` ?? the account default. Phone numbers and scripts still come only from store/env and `CallScript`.
- Tests: `node:test`, no network, no model (translation tests inject `send`).

## Review Focus

- A host reply `हाँ 4821` or `ਹਾਂਜੀ 4821` or `có 4821` approves; `không 4821` declines; `4821` alone is `no_code`. Pinned in Task 1.
- Translation failure or timeout → English text still sent, audit `translate_failed`, no exception reaches the sender. Pinned in Task 1.
- A Hindi host's approval text still contains the literal `YES <code>` / `NO <code>` tokens after translation (so the ASCII path works too). Pinned in Task 1 via the translator prompt plus a post-check that re-inserts them if missing.
- Vendor language `vi` with no `CARTESIA_AGENT_ID_VI` set → falls back to the English agent and audits `agent_language_fallback`. Pinned in Task 2.

---

### Task 1: Language data, translation, replies, scripts

**Files:**
- Create: `src/lib/i18n.ts`, `src/agents/translator.ts`, `tests/i18n.test.ts`
- Modify: `src/lib/types.ts`, `data/seed.json`, `src/agents/intake.ts`, `src/lib/approvals.ts`, `src/agents/outreach.ts`, `src/agents/lead.ts` (the `sendText` helper and `call_vendor`), `src/lib/events.ts` (host call scripts, `createEvent` form language), `src/app/api/events/route.ts` (optional `language` in the body), `tests/approvals.test.ts`, `tests/events.test.ts`, `tests/outreach.test.ts`, `.env.example` (nothing new here; see Task 2)

**Interfaces:**
```ts
// i18n.ts
export const LANGUAGES = ["en","hi","pa","vi"] as const; export type Language = (typeof LANGUAGES)[number];
export const LANGUAGE_NAMES: Record<Language,string>;
export function asLanguage(code: unknown): Language;                 // lower-case, trim; unknown → "en"
export const YES_WORDS: readonly string[]; export const NO_WORDS: readonly string[];  // NFC, lower-case
export const DISCLOSURES: Record<Language,string>;                   // en = existing DISCLOSURE text
export function tokens(body: string): string[];                      // NFC, lower-case, split on /[^\p{L}\p{N}]+/u
export function verbOf(body: string): "YES" | "NO" | null;           // checks 2-word then 1-word prefix against the vocabularies
// translator.ts
export const translatorSpec: AgentSpec<{ text: string }>;            // no tools, effort "low"; output max 600 chars
export async function translate(text: string, lang: Language, audit: AuditEvent[], send?: Send): Promise<string>;
// "en" → text unchanged; cache Map keyed `${lang}\n${text}` (module-level, max 500 entries); on !ok or throw → audit "translate_failed" and return text; post-check: every /\b(YES|NO) \d{4}\b/ token present in the input must appear in the output, else append " (" + tokens.join(" / ") + ")".
// types.ts: Event.language: Language (default "en"); Vendor.language: Language; IntakeOutput.language: Language
// intake.ts: schema gains language: z.enum(LANGUAGES); prompt: "language = ISO 639-1 code of the language the host wrote in: one of en, hi, pa, vi; otherwise en"
// approvals.ts parseReply: verb = verbOf(body); code = first token matching /^\d{4}$/
// outreach.ts: buildCallScript(vendor, brief, questions, audit) reads vendor.language; prompt adds "Write the whole script in <LanguageName>."; ensureDisclosure(script, lang = "en") uses DISCLOSURES[lang] (includes() check against that language's line); DISCLOSURE stays exported as DISCLOSURES.en
// lead.ts sendText(event, channel, to, body, lang = event.language): translate(body, lang, event.audit) before channel.text; vendor texts in events.ts pass vendor.language
// events.ts: createEvent(text, hostPhone, language?) sets event.language = asLanguage(language ?? intake.language); host confirm/final scripts use DISCLOSURES[event.language] and translate() their English question/closing strings; route accepts optional language (z.enum(LANGUAGES))
// seed.json: each vendor gains "language": "en" (keep all en for now; the user sets a teammate's language later)
```

- [ ] **Step 1: Write failing tests** `tests/i18n.test.ts`: `asLanguage("HI")→"hi"`, `asLanguage("xx")→"en"`; `verbOf` for `"हाँ 4821"`, `"ਹਾਂਜੀ 4821"`, `"có 4821"`, `"đồng ý 4821"` → YES; `"không 4821"`, `"nahi 4821"` → NO; `"4821"` → null; `translate("x","en",…)` returns "x" without calling send; a fake `send` returning `{text:"नमस्ते YES 4821"}` is called once for two identical calls (cache); a throwing `send` → returns the English text and audits `translate_failed`; a translation that drops `YES 4821` gets it appended. `tests/approvals.test.ts`: `parseReply("हाँ 4821")` → YES/4821, `"không 4821"` → NO. `tests/outreach.test.ts`: `ensureDisclosure({...}, "hi")` prepends `DISCLOSURES.hi` and leaves an opening that already contains it alone.
- [ ] **Step 2: `npm test`** → fail.
- [ ] **Step 3: Implement.** `i18n.ts` under ~60 lines, `translator.ts` under ~45.
- [ ] **Step 4: `npm test && npx tsc --noEmit && npx eslint <changed files>`** clean.
- [ ] **Step 5: Commit** `git commit -m "feat: language layer: detection, translated texts, multilingual YES/NO, localized scripts"`

---

### Task 2: Cartesia agents per language

**Files:**
- Modify: `src/integrations/cartesia.ts`, `scripts/cartesia-setup.ts`, `tests/cartesia.test.ts`, `.env.example`

**Interfaces:**
```ts
// cartesia.ts
export function agentConfig(voiceId: string, lang: Language): object;  // language.primary = lang; instructions prefixed with `Speak only ${LANGUAGE_NAMES[lang]} for the whole call. ` ; name used by setup: `mela-caller-${lang}`
export function agentIdFor(lang: Language, env = process.env): { id: string; fallback: boolean };
// env[`CARTESIA_AGENT_ID_${lang.toUpperCase()}`] ?? env.CARTESIA_AGENT_ID (fallback: true when the language-specific id is missing and lang !== "en"); throws the setup message if neither exists
// cartesiaCalls: callHost uses event.language, callVendor uses vendor.language; when fallback is true push an audit entry on the event: actor "cartesia", action "agent_language_fallback", detail lang; pass dynamic variable language: LANGUAGE_NAMES[lang]
// scripts/cartesia-setup.ts: for each lang in LANGUAGES: find agent `mela-caller-${lang}` → create or update with agentConfig(voiceFor(lang), lang); print/write CARTESIA_AGENT_ID_<LANG>; keep writing CARTESIA_AGENT_ID = the en agent id; the legacy agent named `mela-caller` (if present) is renamed to `mela-caller-en` via PATCH name, not duplicated
// .env.example: CARTESIA_AGENT_ID_EN=, CARTESIA_AGENT_ID_HI=, CARTESIA_AGENT_ID_PA=, CARTESIA_AGENT_ID_VI=, CARTESIA_VOICE_ID=, CARTESIA_VOICE_ID_HI=, CARTESIA_VOICE_ID_PA=, CARTESIA_VOICE_ID_VI=
```

- [ ] **Step 1: Write failing tests** in `tests/cartesia.test.ts`: `agentConfig(v,"hi").config.language.primary === "hi"` and instructions start with "Speak only Hindi"; `agentIdFor("vi", {CARTESIA_AGENT_ID:"a"})` → `{id:"a", fallback:true}`; `agentIdFor("vi", {CARTESIA_AGENT_ID_VI:"b"})` → `{id:"b", fallback:false}`; `agentIdFor("en", {})` throws; `cartesiaCalls` with a vendor of language `vi` and only `CARTESIA_AGENT_ID` set places the call with agent "a", passes `dynamic_variables.language === "Vietnamese"`, and the event audit gains `agent_language_fallback`.
- [ ] **Step 2: `npm test`** → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: checks clean.**
- [ ] **Step 5: Commit** `git commit -m "feat: one Cartesia agent per language, chosen by the callee's language"`
