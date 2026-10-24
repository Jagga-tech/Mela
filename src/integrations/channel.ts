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
  const text = process.env.MELA_TEXT === "imessage" ? imessageSink : consoleSink;
  const calls = process.env.MELA_CALLS === "cartesia" ? cartesiaCalls(onCallEnded, store) : fakeChannel(onCallEnded, store.seed, text);
  return { callHost: calls.callHost, callVendor: calls.callVendor, text };
}
