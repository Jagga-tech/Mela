import type { Store } from "@/lib/store";
import type { AuditEvent, CallScript } from "@/lib/types";
import { cartesiaCalls } from "@/integrations/cartesia";
import { sendText } from "@/integrations/imessage";

export type OnCallEnded = (callId: string, transcript: string) => Promise<void>;
export type Channel = {
  // audit: the caller's event.audit, so per-call notes (language fallback, translation failures) survive its next save
  callHost(eventId: string, kind: "host_confirm" | "host_final", script: CallScript, audit?: AuditEvent[]): Promise<{ callId: string; providerCallId?: string }>;
  callVendor(eventId: string, vendorId: string, script: CallScript, audit?: AuditEvent[]): Promise<{ callId: string; providerCallId?: string }>;
  text(to: string, body: string): Promise<void>;
};

const imessageSink = async (to: string, body: string) => {
  const r = await sendText(to, body);
  if (!r.ok) console.error("[imessage] send failed", r.reason);
};

export function getChannel(onCallEnded: OnCallEnded, store: Store): Channel {
  console.log("[channel] calls=cartesia texts=imessage");
  return { ...cartesiaCalls(onCallEnded, store), text: imessageSink };
}
