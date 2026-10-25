// Picks an adapter per capability. NEXT_PUBLIC_MELA_LIVE="intake,research" sends those to the
// real backend and keeps the rest on the labeled demo adapter. Default: everything demo.
import type { Capability, MelaService } from "../service";
import { apiAdapter } from "./api";
import { demoAdapter } from "./demo";

const CAPS: Capability[] = ["intake", "research", "calls", "finance", "voice"];

export function parseLive(raw: string | undefined): Record<Capability, boolean> {
  const set = new Set((raw ?? "").split(",").map((s) => s.trim().toLowerCase()));
  const all = set.has("all");
  return Object.fromEntries(CAPS.map((c) => [c, all || set.has(c)])) as Record<Capability, boolean>;
}

export function createService(raw = process.env.NEXT_PUBLIC_MELA_LIVE): MelaService {
  const live = parseLive(raw);
  const demo = demoAdapter();
  const api = apiAdapter();
  const pick = <K extends keyof Omit<MelaService, "live">>(cap: Capability, key: K) => (live[cap] ? api[key] : demo[key]);
  return {
    live,
    intake: pick("intake", "intake"),
    startResearch: pick("research", "startResearch"),
    getResearch: pick("research", "getResearch"),
    cancelResearch: pick("research", "cancelResearch"),
    prepareCall: pick("calls", "prepareCall"),
    approveCall: pick("calls", "approveCall"),
    startCall: pick("calls", "startCall"),
    getCall: pick("calls", "getCall"),
    openFinanceCase: pick("finance", "openFinanceCase"),
    decideFinance: pick("finance", "decideFinance"),
    // Voice always goes through this app's own /api/voice routes; they report whether Cartesia is configured.
    voiceStatus: api.voiceStatus,
    transcribe: api.transcribe,
    speak: api.speak,
  };
}
