import { randomUUID } from "node:crypto";
import type { Store } from "@/lib/store";
import type { CallScript } from "@/lib/types";
import type { Channel, OnCallEnded } from "@/integrations/channel";

// ponytail: stub until the Cartesia booth confirms Line's outbound API and transcript delivery
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function placeCall(_args: { to: string; script: CallScript; callId: string }): Promise<void> {
  if (!process.env.CARTESIA_API_KEY) throw new Error("Cartesia not configured");
  throw new Error("Cartesia outbound API not wired yet; confirm Line API at the booth");
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
