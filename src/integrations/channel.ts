import type { Store } from "@/lib/store";
import type { CallScript } from "@/lib/types";
import { fakeChannel } from "@/integrations/fakeChannel";
import { cartesiaCalls } from "@/integrations/cartesia";
import { sendText } from "@/integrations/imessage";

export type OnCallEnded = (callId: string, transcript: string) => Promise<void>;
export type Channel = {
  callHost(eventId: string, kind: "host_confirm" | "host_final", script: CallScript): Promise<{ callId: string }>;
  callVendor(eventId: string, vendorId: string, script: CallScript): Promise<{ callId: string }>;
  text(to: string, body: string): Promise<void>;
};

const consoleSink = async (to: string, body: string) => console.log(`[text → ${to}] ${body}`);
const imessageSink = async (to: string, body: string) => {
  const r = await sendText(to, body);
  if (!r.ok) console.error("[imessage] send failed", r.reason);
};

export function getChannel(onCallEnded: OnCallEnded, store: Store): Channel {
  const { MELA_TEXT, MELA_CALLS } = process.env;
  if (MELA_TEXT && !["console", "imessage"].includes(MELA_TEXT)) console.warn(`[channel] unknown MELA_TEXT=${MELA_TEXT}, using console`);
  if (MELA_CALLS && !["fake", "cartesia"].includes(MELA_CALLS)) console.warn(`[channel] unknown MELA_CALLS=${MELA_CALLS}, using fake`);
  const textName = MELA_TEXT === "imessage" ? "imessage" : "console", callsName = MELA_CALLS === "cartesia" ? "cartesia" : "fake";
  console.log(`[channel] calls=${callsName} texts=${textName}`);
  const text = textName === "imessage" ? imessageSink : consoleSink;
  const calls = callsName === "cartesia" ? cartesiaCalls(onCallEnded, store) : fakeChannel(onCallEnded, store.seed, text);
  return { callHost: calls.callHost, callVendor: calls.callVendor, text };
}
