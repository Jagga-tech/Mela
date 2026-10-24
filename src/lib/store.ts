import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Event, Vendor, VendorCategory, VendorRisk } from "@/lib/types";
import { isFromHost } from "@/integrations/phone";

export type Seed = { vendors: Vendor[];
  mandate: { capCents: number; expiresAt: string } };
export type Store = {
  createEvent(hostPhone: string): Promise<Event>;
  getEvent(id: string): Promise<Event | null>;
  saveEvent(e: Event): Promise<void>;
  findEventByCallId(callId: string): Promise<Event | null>;
  findEventByHostPhone(phone: string): Promise<Event | null>;
  findEventByPendingCode(code: string): Promise<Event | null>;
  listVendors(category?: VendorCategory): Promise<Vendor[]>;
  getVendor(id: string): Promise<Vendor | null>;
  claimIdempotencyKey(key: string): Promise<boolean>;
  getVendorRisk(vendorId: string): Promise<VendorRisk | null>;
  saveVendorRisk(r: VendorRisk): Promise<void>;
  seed: Seed;
};
type Data = { events: Record<string, Event>; keys: string[]; risks?: Record<string, VendorRisk> };

// events saved before the finance records and the language field existed
const withDefaults = (e: Event | null): Event | null => {
  if (e) { e.purchaseOrders ??= []; e.invoices ??= []; e.financeExceptions ??= []; e.language ??= "en"; }
  return e;
};

export function fileStore(path = process.env.MELA_STORE ?? "data/store.json"): Store {
  const seed: Seed = JSON.parse(readFileSync(join(process.cwd(), "data/seed.json"), "utf8"));
  // VENDOR_PHONE_<vendorId> points a seed vendor at a real phone for the live demo
  for (const v of seed.vendors) v.phone = process.env[`VENDOR_PHONE_${v.id}`] ?? v.phone;
  // ponytail: whole-file JSON store, SpacetimeDB replaces it
  const read = (): Data => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { events: {}, keys: [] };
  const write = (d: Data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(d, null, 2)); };
  const events = () => Object.values(read().events);
  return {
    seed,
    async createEvent(hostPhone) {
      const now = new Date().toISOString(), id = randomUUID();
      const e: Event = { id, hostPhone, status: "draft", brief: null, missing: [], shortlist: [], calls: [], quotes: [],
        approvals: [], payments: [], messages: [], humanTasks: [], research: [], audit: [], purchaseOrders: [], invoices: [], financeExceptions: [], language: "en", createdAt: now, updatedAt: now,
        mandate: { id: randomUUID(), eventId: id, vendorIds: seed.vendors.map(v => v.id), capCents: seed.mandate.capCents,
          spentCents: 0, expiresAt: seed.mandate.expiresAt, status: "approved" } };
      const d = read(); d.events[id] = e; write(d);
      return e;
    },
    async getEvent(id) {
      return withDefaults(read().events[id] ?? null);
    },
    async saveEvent(e) { const d = read(); e.updatedAt = new Date().toISOString(); d.events[e.id] = e; write(d); },
    async findEventByCallId(callId) { return withDefaults(events().find(e => e.calls.some(c => c.id === callId)) ?? null); },
    async findEventByHostPhone(phone) {
      // >= so ties go to the later-inserted event
      return withDefaults(events().filter(e => isFromHost(phone, e.hostPhone))
        .reduce<Event | null>((best, e) => !best || e.updatedAt >= best.updatedAt ? e : best, null));
    },
    async findEventByPendingCode(code) { return withDefaults(events().find(e => e.approvals.some(a => a.status === "pending" && a.code === code)) ?? null); },
    async listVendors(category) { return seed.vendors.filter(v => !category || v.category === category); },
    async getVendor(id) { return seed.vendors.find(v => v.id === id) ?? null; },
    async claimIdempotencyKey(key) {
      const d = read(); if (d.keys.includes(key)) return false;
      d.keys.push(key); write(d); return true;
    },
    async getVendorRisk(vendorId) { return read().risks?.[vendorId] ?? null; },
    async saveVendorRisk(r) { const d = read(); (d.risks ??= {})[r.vendorId] = r; write(d); },
  };
}

export const store: Store = fileStore();
