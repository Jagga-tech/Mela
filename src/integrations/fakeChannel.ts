import { randomUUID } from "node:crypto";
import type { Seed } from "@/lib/store";
import type { Channel, OnCallEnded } from "@/integrations/channel";

export function fakeChannel(onCallEnded: OnCallEnded, seed: Seed, sink?: (to: string, body: string) => void): Channel {
  const call = async (transcript: string) => {
    const callId = randomUUID();
    setImmediate(() => { onCallEnded(callId, transcript).catch((e) => console.error("[fakeChannel] onCallEnded failed", e)); });
    return { callId };
  };
  return {
    callHost: (_eventId, kind) => call(seed.transcripts[kind]),
    callVendor: (_eventId, vendorId) => call(seed.transcripts.vendors[vendorId] ?? "No answer."),
    async text(to, body) { (sink ?? ((t, b) => console.log(`[text → ${t}] ${b}`)))(to, body); },
  };
}
