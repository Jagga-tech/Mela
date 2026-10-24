import type { Store } from "@/lib/store";
import type { CallScript } from "@/lib/types";
import { fakeChannel } from "@/integrations/fakeChannel";

export type OnCallEnded = (callId: string, transcript: string) => Promise<void>;
export type Channel = {
  callHost(eventId: string, kind: "host_confirm" | "host_final", script: CallScript): Promise<{ callId: string }>;
  callVendor(eventId: string, vendorId: string, script: CallScript): Promise<{ callId: string }>;
  text(to: string, body: string): Promise<void>;
};

export function getChannel(onCallEnded: OnCallEnded, store: Store): Channel {
  if (process.env.MELA_CALLS === "cartesia" || process.env.MELA_TEXT === "imessage") throw new Error("not implemented until Task 12");
  return fakeChannel(onCallEnded, store.seed, (to, body) => console.log(`[text → ${to}] ${body}`));
}
