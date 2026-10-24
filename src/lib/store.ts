import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Event, Vendor, VendorCategory } from "@/lib/types";

export type Seed = { vendors: Vendor[];
  transcripts: { host_confirm: string; host_final: string; vendors: Record<string, string> };
  mandate: { capCents: number; expiresAt: string } };
export type Store = {
  createEvent(hostPhone: string, hostName?: string): Promise<Event>;
  getEvent(id: string): Promise<Event | null>;
  saveEvent(e: Event): Promise<void>;
  findEventByCallId(callId: string): Promise<Event | null>;
  findEventByHostPhone(phone: string): Promise<Event | null>;
  findEventByPendingCode(code: string): Promise<Event | null>;
  listVendors(category?: VendorCategory): Promise<Vendor[]>;
  getVendor(id: string): Promise<Vendor | null>;
  claimIdempotencyKey(key: string): Promise<boolean>;
  seed: Seed;
};
type Data = { events: Record<string, Event>; keys: string[] };

const digits = (s: string) => s.replace(/\D/g, "");

export function fileStore(path = process.env.MELA_STORE ?? "data/store.json"): Store {
  const seed: Seed = JSON.parse(readFileSync(join(process.cwd(), "data/seed.json"), "utf8"));
  // ponytail: whole-file JSON store, SpacetimeDB replaces it
  const read = (): Data => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { events: {}, keys: [] };
  const write = (d: Data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(d, null, 2)); };
  const events = () => Object.values(read().events);
  return {
    seed,
    async createEvent(hostPhone, hostName) {
      const now = new Date().toISOString(), id = randomUUID();
      const e: Event = { id, hostPhone, ...(hostName ? { hostName } : {}), status: "draft", brief: null, missing: [], shortlist: [], calls: [], quotes: [],
        approvals: [], payments: [], messages: [], humanTasks: [], research: [], audit: [], createdAt: now, updatedAt: now,
        mandate: { id: randomUUID(), eventId: id, vendorIds: seed.vendors.map(v => v.id), capCents: seed.mandate.capCents,
          spentCents: 0, expiresAt: seed.mandate.expiresAt, status: "approved" } };
      const d = read(); d.events[id] = e; write(d);
      return e;
    },
    async getEvent(id) { return read().events[id] ?? null; },
    async saveEvent(e) { const d = read(); e.updatedAt = new Date().toISOString(); d.events[e.id] = e; write(d); },
    async findEventByCallId(callId) { return events().find(e => e.calls.some(c => c.id === callId)) ?? null; },
    async findEventByHostPhone(phone) {
      // >= so ties go to the later-inserted event
      return events().filter(e => digits(e.hostPhone) === digits(phone))
        .reduce<Event | null>((best, e) => !best || e.updatedAt >= best.updatedAt ? e : best, null);
    },
    async findEventByPendingCode(code) { return events().find(e => e.approvals.some(a => a.status === "pending" && a.code === code)) ?? null; },
    async listVendors(category) { return seed.vendors.filter(v => !category || v.category === category); },
    async getVendor(id) { return seed.vendors.find(v => v.id === id) ?? null; },
    async claimIdempotencyKey(key) {
      const d = read(); if (d.keys.includes(key)) return false;
      d.keys.push(key); write(d); return true;
    },
  };
}

export const store: Store = fileStore();
