import "server-only";

// Env vars for host-approved vendor calls. Read only here, only on the server.
//   CARTESIA_API_KEY         Cartesia API key (also used by /api/voice)
//   CARTESIA_AGENT_ID        the vendor-call agent (configure it with VENDOR_AGENT_SETUP)
//   CARTESIA_FROM_NUMBER_ID  phone number id the agent calls from (Cartesia number, "ap_...")
//   MELA_ROLEPLAY_PHONE      E.164 number of the consenting teammate who plays the vendor
//   MELA_ROLEPLAY_LABEL      optional, shown as the number's source in the plan
//   CARTESIA_WEBHOOK_SECRET  optional, enables POST /api/calls/webhook

export type Env = Record<string, string | undefined>;

export class NotConnectedError extends Error {
  constructor(readonly missing: string[], message?: string) {
    super(message ?? `Phone calls aren't connected yet: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set on the server.`);
    this.name = "NotConnectedError";
  }
}

export const E164 = /^\+[1-9]\d{7,14}$/;

export interface RolePlayLine {
  phone: string;
  label: string;
}

/** The only number Mela ever dials: a teammate who agreed to play the vendor. */
export function rolePlayLine(env: Env = process.env): RolePlayLine {
  const phone = env.MELA_ROLEPLAY_PHONE?.trim();
  if (!phone) throw new NotConnectedError(["MELA_ROLEPLAY_PHONE"]);
  if (!E164.test(phone)) throw new NotConnectedError(["MELA_ROLEPLAY_PHONE"], "Phone calls aren't connected yet: MELA_ROLEPLAY_PHONE must be in E.164 format, like +14155550123.");
  return { phone, label: env.MELA_ROLEPLAY_LABEL?.trim() || "Teammate role-play line (consenting; not the vendor's listed number)" };
}

export interface CartesiaCallConfig {
  apiKey: string;
  agentId: string;
  fromNumberId: string;
}

export function cartesiaCallConfig(env: Env = process.env): CartesiaCallConfig {
  const missing = ["CARTESIA_API_KEY", "CARTESIA_AGENT_ID", "CARTESIA_FROM_NUMBER_ID"].filter((k) => !env[k]?.trim());
  if (missing.length) throw new NotConnectedError(missing);
  return { apiKey: env.CARTESIA_API_KEY!.trim(), agentId: env.CARTESIA_AGENT_ID!.trim(), fromNumberId: env.CARTESIA_FROM_NUMBER_ID!.trim() };
}

export const webhookSecret = (env: Env = process.env) => env.CARTESIA_WEBHOOK_SECRET?.trim() || null;

export const digits = (phone: string) => phone.replace(/\D/g, "");
