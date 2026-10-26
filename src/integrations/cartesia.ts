import { randomUUID } from "node:crypto";
import type { Store } from "@/lib/store";
import type { AuditEvent, CallKind, CallScript } from "@/lib/types";
import type { Channel, OnCallEnded } from "@/integrations/channel";
import { normalizePhone } from "@/integrations/phone";
import { asLanguage, DISCLOSURES, LANGUAGE_NAMES, type Language } from "@/lib/i18n";
import { translate } from "@/agents/translator";
import type { Send } from "@/agents/harness";

export const LEGACY_AGENT_NAME = "mela-caller";
export const agentName = (lang: Language) => `mela-caller-${lang}`;
const SETUP = "Cartesia not configured: run npm run cartesia:setup";
export const AGENT_INSTRUCTIONS = `You are Mela, an AI assistant placing a phone call on behalf of a client who is planning an event. Say you are an AI assistant if asked. This call is recorded and transcribed.

Purpose, from the call kind "{{call_kind}}":
- vendor: ask about availability, price and deposit for the client's event.
- host_confirm: read back the event brief to the client and accept any corrections.
- host_final: share the booking confirmations and thank the client.

Ask only these questions, separated by " | ", one at a time: {{questions}}
Confirm every number back to the person (dates, prices, guest counts).
Never agree to: {{must_not_agree_to}}. Never state a price as decided. If asked to commit to anything, say "I'll pass that to the client."
Keep your answers short and natural.
When the questions are answered, say "{{closing}}" and then use the end_call tool.`;

type Line = { role: string; text: string | null };
type CallStatus = { status: string; endReason: string | null; transcript: Line[] | null };
export type CartesiaClient = {
  listPhoneNumbers(): Promise<{ id: string; number?: string; label?: string }[]>;
  provisionNumber(label: string): Promise<{ id: string; number?: string }>;
  listAgents(): Promise<{ id: string; name: string }[]>;
  createAgent(name: string, config: object): Promise<{ id: string }>;
  updateAgent(id: string, name: string, config: object): Promise<void>;
  placeCall(args: { fromNumberId: string; agentId: string; toNumber: string; variables: Record<string, string> }): Promise<{ agentCallId: string }>;
  getCall(agentCallId: string): Promise<CallStatus>;
};

export function cartesiaClient(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): CartesiaClient {
  const key = env.CARTESIA_API_KEY;
  if (!key) throw new Error("Cartesia not configured");
  const req = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetchImpl("https://api.cartesia.ai" + path, {
      method, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
      // docs use one auth header or the other per endpoint; both are accepted
      headers: { "X-API-Key": key, Authorization: `Bearer ${key}`, "Cartesia-Version": "2026-08-14", "Content-Type": "application/json" },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`cartesia ${res.status} ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : {}) as T;
  };
  const list = <T>(r: T[] | { data: T[] }) => (Array.isArray(r) ? r : r.data);
  return {
    listPhoneNumbers: async () => list(await req("GET", "/agents/phone-numbers")),
    provisionNumber: (label) => req("POST", "/agents/phone-numbers/provision", { label }),
    listAgents: async () => list(await req("GET", "/v1/agents")),
    createAgent: (name, config) => req("POST", "/v1/agents", { name, description: "Mela outbound caller", config }),
    // sending the name too renames a legacy "mela-caller" to "mela-caller-en"
    updateAgent: async (id, name, config) => { await req("PATCH", `/v1/agents/${id}`, { name, config }); },
    async placeCall({ fromNumberId, agentId, toNumber, variables }) {
      const r = await req<{ calls: { agent_call_id?: string; error?: string }[] }>("POST", "/agents/calls", {
        from_number_id: fromNumberId, agent_id: agentId, ringing_timeout_seconds: 45,
        outbound_calls: [{ to_number: toNumber, dynamic_variables: variables }] });
      const c = r.calls?.[0];
      if (!c?.agent_call_id) throw new Error(c?.error ?? "cartesia returned no call id");
      return { agentCallId: c.agent_call_id };
    },
    async getCall(id) {
      const r = await req<{ status: string; end_reason?: string | null; transcript?: Line[] | null }>("GET", `/agents/calls/${id}`);
      return { status: r.status, endReason: r.end_reason ?? null, transcript: r.transcript ?? null };
    },
  };
}

const languagePrefix = (lang: Language) => lang === "en" ? "" :
  `You speak only ${LANGUAGE_NAMES[lang]} with the person on the call. The call script variables below are written in English; convey their meaning naturally in ${LANGUAGE_NAMES[lang]}, keeping numbers, names and amounts exact. `;

export const agentConfig = (voiceId: string, lang: Language): object => ({
  instructions: languagePrefix(lang) + AGENT_INSTRUCTIONS, initial_message: "{{opening}}", model: { id: "claude-sonnet-5" },
  language: { primary: lang }, audio: { output: { voice_id: voiceId } },
  system_tools: {
    end_call: { description: "End the call after saying the closing line.", pre_tool_speech: "auto" },
    voicemail_detection: { description: "Detect a voicemail greeting or answering machine.", pre_tool_speech: "auto",
      message: "Hi, this is Mela, an AI assistant calling on behalf of a client. We'll follow up later. Thank you." },
  },
  turn: { inactivity_end_call_secs: 120, inactivity_check_in_secs: 8 },
});

// questions, closing and must_not_agree_to stay English; the agent conveys them in `language`
export const scriptVariables = (kind: CallKind, script: CallScript, melaCallId: string, opening = script.opening, lang: Language = "en"): Record<string, string> => ({
  call_kind: kind, opening, questions: script.questions.join(" | "), closing: script.closing,
  must_not_agree_to: script.mustNotAgreeTo.join(", "), mela_call_id: melaCallId, language: LANGUAGE_NAMES[lang] });

export function agentIdFor(lang: Language, env: NodeJS.ProcessEnv = process.env): { id: string; fallback: boolean } {
  const own = env[`CARTESIA_AGENT_ID_${lang.toUpperCase()}`];
  const id = own || env.CARTESIA_AGENT_ID;
  if (!id) throw new Error(SETUP);
  return { id, fallback: !own && lang !== "en" };
}

// The spoken opening: the fixed disclosure in the callee's language, then the rest of the English opening translated.
export async function localizedOpening(script: CallScript, lang: Language, audit: AuditEvent[], send?: Send): Promise<string> {
  if (lang === "en") return script.opening;
  const rest = script.opening.replace(DISCLOSURES.en, "").replace(DISCLOSURES[lang], "").trim();
  return rest ? `${DISCLOSURES[lang]} ${await translate(rest, lang, audit, send)}` : DISCLOSURES[lang];
}

const ROLE: Record<string, string> = { assistant: "Agent", user: "Callee" };
export const transcriptText = (items: Line[] | null): string =>
  (items ?? []).filter((l) => l.text && ROLE[l.role]).map((l) => `${ROLE[l.role]}: ${l.text}`).join("\n");

const NO_ANSWER = new Set(["dial_no_answer", "dial_busy", "dial_failed", "dial_timeout", "voicemail_detected"]);
export function finalTranscript(call: CallStatus): string | null {
  if (call.status !== "completed" && call.status !== "failed") return null;
  if (call.endReason && NO_ANSWER.has(call.endReason)) return "No answer.";
  const text = transcriptText(call.transcript);
  return text || "Call did not complete."; // ponytail: an empty completed call is reported like a failed one
}

export async function pollUntilEnded(client: CartesiaClient, agentCallId: string, onDone: (t: string) => Promise<void>,
  { intervalMs = 5000, maxMs = 20 * 60_000, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {}): Promise<void> {
  // sleep first: the caller persists the CallRecord after we return, before onDone can look it up
  for (let waited = 0; waited < maxMs; waited += intervalMs) {
    await sleep(intervalMs);
    try {
      const call = await client.getCall(agentCallId);
      const t = finalTranscript(call);
      if (t !== null) { console.log(`[cartesia] call ${agentCallId} ${call.status}/${call.endReason}`); return onDone(t); }
    } catch (e) { console.error(`[cartesia] get call ${agentCallId} failed, retrying`, String(e)); }
  }
  console.log(`[cartesia] call ${agentCallId} timeout/poll_gave_up`);
  return onDone("Call did not complete.");
}

export function cartesiaCalls(onCallEnded: OnCallEnded, store: Store, client?: CartesiaClient, send?: Send): Pick<Channel, "callHost" | "callVendor"> {
  // audit: the caller's event.audit (it saves the event right after); without it the event is loaded and saved here
  const call = async (eventId: string, kind: CallKind, phone: string, script: CallScript, lang: Language, audit?: AuditEvent[]) => {
    const { id: agentId, fallback } = agentIdFor(lang);
    const fromNumberId = process.env.CARTESIA_PHONE_NUMBER_ID;
    if (!fromNumberId) throw new Error(SETUP);
    const toNumber = normalizePhone(phone);
    if (!toNumber) throw new Error(`invalid phone ${phone}`);
    const event = audit ? null : await store.getEvent(eventId);
    const log = audit ?? event?.audit ?? [];
    const before = log.length;
    if (fallback) log.push({ at: new Date().toISOString(), actor: "cartesia", action: "agent_language_fallback", detail: lang });
    const opening = await localizedOpening(script, lang, log, send);
    if (event && log.length > before) await store.saveEvent(event);
    const c = client ?? cartesiaClient();
    const callId = randomUUID();
    const { agentCallId } = await c.placeCall({ fromNumberId, agentId, toNumber, variables: scriptVariables(kind, script, callId, opening, lang) });
    void pollUntilEnded(c, agentCallId, (t) => onCallEnded(callId, t)).catch(console.error);
    return { callId, providerCallId: agentCallId };
  };
  return {
    async callHost(eventId, kind, script, audit) {
      const event = await store.getEvent(eventId);
      if (!event) throw new Error(`unknown event ${eventId}`);
      return call(eventId, kind, event.hostPhone, script, asLanguage(event.language), audit);
    },
    async callVendor(eventId, vendorId, script, audit) {
      const vendor = await store.getVendor(vendorId);
      if (!vendor?.phone) throw new Error(`no phone for vendor ${vendorId}`); // VENDOR_PHONE_<id> override is applied when the store loads the seed
      return call(eventId, "vendor", vendor.phone, script, asLanguage(vendor.language), audit);
    },
  };
}
