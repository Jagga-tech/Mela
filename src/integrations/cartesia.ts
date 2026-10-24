import { randomUUID } from "node:crypto";
import type { Store } from "@/lib/store";
import type { CallKind, CallScript } from "@/lib/types";
import type { Channel, OnCallEnded } from "@/integrations/channel";
import { normalizePhone } from "@/integrations/phone";

export const AGENT_NAME = "mela-caller";
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
  createAgent(config: object): Promise<{ id: string }>;
  updateAgent(id: string, config: object): Promise<void>;
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
    createAgent: (config) => req("POST", "/v1/agents", { name: AGENT_NAME, description: "Mela outbound caller", config }),
    updateAgent: async (id, config) => { await req("PATCH", `/v1/agents/${id}`, { config }); },
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

export const agentConfig = (voiceId: string): object => ({
  instructions: AGENT_INSTRUCTIONS, initial_message: "{{opening}}", model: { id: "claude-sonnet-5" },
  language: { primary: "en" }, audio: { output: { voice_id: voiceId } },
  system_tools: {
    end_call: { description: "End the call after saying the closing line.", pre_tool_speech: "auto" },
    voicemail_detection: { description: "Detect a voicemail greeting or answering machine.", pre_tool_speech: "auto",
      message: "Hi, this is Mela, an AI assistant calling on behalf of a client. We'll follow up later. Thank you." },
  },
  turn: { inactivity_end_call_secs: 120, inactivity_check_in_secs: 8 },
});

export const scriptVariables = (kind: CallKind, script: CallScript, melaCallId: string): Record<string, string> => ({
  call_kind: kind, opening: script.opening, questions: script.questions.join(" | "), closing: script.closing,
  must_not_agree_to: script.mustNotAgreeTo.join(", "), mela_call_id: melaCallId });

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

export function cartesiaCalls(onCallEnded: OnCallEnded, store: Store, client?: CartesiaClient): Pick<Channel, "callHost" | "callVendor"> {
  const call = async (kind: CallKind, phone: string, script: CallScript) => {
    const { CARTESIA_AGENT_ID: agentId, CARTESIA_PHONE_NUMBER_ID: fromNumberId } = process.env;
    if (!agentId || !fromNumberId) throw new Error("Cartesia not configured: run npm run cartesia:setup");
    const toNumber = normalizePhone(phone);
    if (!toNumber) throw new Error(`invalid phone ${phone}`);
    const c = client ?? cartesiaClient();
    const callId = randomUUID();
    const { agentCallId } = await c.placeCall({ fromNumberId, agentId, toNumber, variables: scriptVariables(kind, script, callId) });
    void pollUntilEnded(c, agentCallId, (t) => onCallEnded(callId, t)).catch(console.error);
    return { callId, providerCallId: agentCallId };
  };
  return {
    async callHost(eventId, kind, script) {
      const event = await store.getEvent(eventId);
      if (!event) throw new Error(`unknown event ${eventId}`);
      return call(kind, event.hostPhone, script);
    },
    async callVendor(_eventId, vendorId, script) {
      const vendor = await store.getVendor(vendorId);
      if (!vendor?.phone) throw new Error(`no phone for vendor ${vendorId}`); // VENDOR_PHONE_<id> override is applied when the store loads the seed
      return call("vendor", vendor.phone, script);
    },
  };
}
