import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "@/lib/store";
import type { CallScript } from "@/lib/types";
import type { Channel, OnCallEnded } from "@/integrations/channel";

// ---------------------------------------------------------------------------
// Cartesia agent calls (server only). Every request shape below comes from the docs:
//   Outbound call:  POST /agents/calls
//     https://docs.cartesia.ai/line/integrations/telephony/outbound-dialing
//     https://docs.cartesia.ai/api-reference/agents/calls/create-outbound-call
//   Call status + transcript:  GET /agents/calls/{call_id}
//     https://docs.cartesia.ai/api-reference/agents/calls/get-call
//   Webhooks (call_started / call_turn / call_completed / call_failed, x-webhook-secret):
//     https://docs.cartesia.ai/line/infrastructure/observability#webhooks
//   Per-call values for the agent's greeting and instructions:
//     https://docs.cartesia.ai/agents/dynamic-variables
// ---------------------------------------------------------------------------

export const CARTESIA_API = "https://api.cartesia.ai";
export const CARTESIA_CALLS_VERSION = "2026-08-14";

/**
 * Paste into the Cartesia vendor-call agent (Playground → agent → configuration).
 * The greeting is ONLY the disclosure variable, so every call opens with Mela's AI disclosure.
 * The server also checks the transcript: a call whose first agent turn lacks the disclosure keeps no answers.
 */
export const VENDOR_AGENT_SETUP = {
  initial_message: "{{mela_disclosure}}",
  instructions: [
    "# Identity",
    "You are Mela, an AI assistant calling a venue or caterer for a host who is planning an event. You are not a person and never claim to be.",
    "# Script",
    "Context to share: {{mela_opening}}",
    "Shared details you may mention: {{mela_shared_details}}",
    "Ask these questions in order, word for word, one at a time, and wait for each answer:",
    "{{mela_questions}}",
    "# Guardrails",
    "Never agree to: {{mela_must_not}}.",
    "Never share the host's budget, phone number or email, or anything not listed above.",
    "If the vendor offers to book, hold, take a deposit or card details, say the host will follow up in writing.",
    "Do not invent or repeat back prices or dates you did not hear. After the last question, thank them, say the host will follow up in writing, and end the call.",
  ].join("\n"),
} as const;

export class CartesiaApiError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean) {
    super(message);
    this.name = "CartesiaApiError";
  }
}

export type FetchFn = typeof fetch;

export interface CartesiaAuth {
  apiKey: string;
  fetchImpl?: FetchFn;
  timeoutMs?: number;
}

const headers = (apiKey: string) => ({
  "X-API-Key": apiKey,
  "Cartesia-Version": CARTESIA_CALLS_VERSION,
  "Content-Type": "application/json",
});

const OutboundResponse = z.object({
  calls: z.array(z.object({ number: z.string(), agent_call_id: z.string().optional(), error: z.record(z.string(), z.unknown()).optional() }).passthrough()),
});

export const AgentTranscriptTurn = z
  .object({ role: z.string(), text: z.string().nullable().optional(), start_timestamp: z.number().optional(), end_timestamp: z.number().optional() })
  .passthrough();
export type AgentTranscriptTurn = z.infer<typeof AgentTranscriptTurn>;

/** GET /agents/calls/{call_id} → AgentCall, and the `call` field of webhook events. Only the fields Mela reads. */
export const AgentCall = z
  .object({
    id: z.string(),
    agent_id: z.string().optional(),
    status: z.string().optional(), // created | started | completed | failed
    start_time: z.string().nullable().optional(),
    end_time: z.string().nullable().optional(),
    transcript: z.array(AgentTranscriptTurn).nullable().optional(),
    telephony_params: z.object({ to: z.string().optional(), from: z.string().optional(), direction: z.string().optional() }).passthrough().nullable().optional(),
    error_message: z.string().nullable().optional(),
    end_reason: z.string().nullable().optional(),
  })
  .passthrough();
export type AgentCall = z.infer<typeof AgentCall>;

export const WebhookEvent = z
  .object({
    type: z.string(),
    call_id: z.string(),
    agent_id: z.string().optional(),
    webhook_request_id: z.string().optional(),
    timestamp: z.string().optional(),
    call: AgentCall.optional(),
    turn: AgentTranscriptTurn.optional(),
  })
  .passthrough();
export type WebhookEvent = z.infer<typeof WebhookEvent>;

async function send(auth: CartesiaAuth, method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const doFetch = auth.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${CARTESIA_API}${path}`, {
      method,
      headers: headers(auth.apiKey),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(auth.timeoutMs ?? 10_000),
    });
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code;
    // Only errors that happen before the request reaches Cartesia are safe to retry:
    // after a timeout the call may have been placed anyway.
    const beforeSend = code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN";
    const timedOut = (err as Error).name === "TimeoutError";
    throw new CartesiaApiError(timedOut ? "Cartesia didn't answer in time" : `Couldn't reach Cartesia (${code ?? (err as Error).name})`, null, beforeSend);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = json && typeof json === "object" ? JSON.stringify(json).slice(0, 300) : "";
    // Documented 500 = "Outbound calling is temporarily unavailable, or provider setup failed".
    const retryable = res.status === 429 || res.status >= 500;
    throw new CartesiaApiError(`Cartesia returned ${res.status}${detail ? `: ${detail}` : ""}`, res.status, retryable);
  }
  return json;
}

/** Place one outbound call. Returns Cartesia's agent_call_id, or throws with the per-destination error. */
export async function createOutboundCall(
  auth: CartesiaAuth,
  args: { agentId: string; fromNumberId: string; toNumber: string; dynamicVariables: Record<string, string>; ringingTimeoutSeconds?: number; maxCallDurationMinutes?: number },
): Promise<{ agentCallId: string }> {
  const json = await send(auth, "POST", "/agents/calls", {
    from_number_id: args.fromNumberId,
    agent_id: args.agentId,
    ringing_timeout_seconds: args.ringingTimeoutSeconds ?? 30,
    max_call_duration_minutes: args.maxCallDurationMinutes ?? 6,
    outbound_calls: [{ to_number: args.toNumber, dynamic_variables: args.dynamicVariables }],
  });
  const parsed = OutboundResponse.safeParse(json);
  if (!parsed.success || parsed.data.calls.length !== 1) throw new CartesiaApiError("Cartesia's call response had an unexpected shape", 200, false);
  const call = parsed.data.calls[0]!;
  // 200 can still carry a per-destination error; check the entry, not just the status.
  if (call.error || !call.agent_call_id) throw new CartesiaApiError(`Cartesia couldn't start the call: ${JSON.stringify(call.error ?? {}).slice(0, 300)}`, 200, false);
  return { agentCallId: call.agent_call_id };
}

export async function getAgentCall(auth: CartesiaAuth, callId: string): Promise<AgentCall> {
  const json = await send(auth, "GET", `/agents/calls/${encodeURIComponent(callId)}`);
  const parsed = AgentCall.safeParse(json);
  if (!parsed.success) throw new CartesiaApiError("Cartesia's call status had an unexpected shape", 200, false);
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Legacy autonomous flow (src/integrations/channel.ts, MELA_CALLS=cartesia).
// Intentionally not wired: it would dial a vendor's listed number without a host
// approval. Host-approved calls go through /api/calls (src/lib/calls/service.ts).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function placeCall(_args: { to: string; script: CallScript; callId: string }): Promise<void> {
  if (!process.env.CARTESIA_API_KEY) throw new Error("Cartesia not configured");
  throw new Error("The autonomous call loop is disabled; vendor calls go through the host-approved /api/calls endpoints");
}

// onCallEnded is unused: the transcript will arrive via /api/webhooks/call-ended once Line is wired.
export function cartesiaCalls(_onCallEnded: OnCallEnded, store: Store): Pick<Channel, "callHost" | "callVendor"> {
  return {
    async callHost(eventId, _kind, script) {
      const event = await store.getEvent(eventId);
      if (!event) throw new Error(`unknown event ${eventId}`);
      const callId = randomUUID();
      await placeCall({ to: event.hostPhone, script, callId });
      return { callId };
    },
    async callVendor(_eventId, vendorId, script) {
      const vendor = await store.getVendor(vendorId);
      const to = process.env[`VENDOR_PHONE_${vendorId}`] ?? vendor?.phone;
      if (!to) throw new Error(`no phone for vendor ${vendorId}`);
      const callId = randomUUID();
      await placeCall({ to, script, callId });
      return { callId };
    },
  };
}
