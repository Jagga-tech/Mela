import { randomBytes } from "node:crypto";

export type VisaAdapter = { pay(args: { amountCents: number; vendorId: string; idempotencyKey: string }): Promise<{ ref: string; simulated: boolean }> };

export function simulatedVisa(): VisaAdapter {
  return { pay: () => new Promise(res => setImmediate(() => res({ ref: "SIM-" + randomBytes(4).toString("hex"), simulated: true }))) };
}

function sandboxVisa(): VisaAdapter {
  // ponytail: not wired until the Visa booth confirms an API; implement the sandbox call here
  return { pay: async () => { throw new Error("Visa sandbox not configured"); } };
}

export function getVisa(): VisaAdapter { return process.env.VISA_API_KEY ? sandboxVisa() : simulatedVisa(); }
