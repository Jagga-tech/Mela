import type { Approval, ApprovalKind, Event } from "./types";

export const APPROVAL_TTL_MS = 30 * 60 * 1000;

export function createApproval(event: Event, kind: ApprovalKind, summary: string, now: Date): Approval {
  const pending = new Set(event.approvals.filter((a) => a.status === "pending").map((a) => a.code));
  let code: string;
  do code = String(Math.floor(1000 + Math.random() * 9000));
  while (pending.has(code));
  const approval: Approval = { id: crypto.randomUUID(), eventId: event.id, kind, code, summary, status: "pending",
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString() };
  event.approvals.push(approval);
  return approval;
}

export function parseReply(body: string): { verb: "YES" | "NO" | null; code: string | null } {
  const tokens = body.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(Boolean);
  const first = tokens[0];
  return { verb: first === "yes" ? "YES" : first === "no" ? "NO" : null, code: tokens.find((t) => /^\d{4}$/.test(t)) ?? null };
}

export type ReplyOutcome = "approved" | "declined" | "expired" | "wrong_sender" | "no_code" | "unknown_code" | "already_answered";

const digits = (s: string) => s.replace(/\D/g, "");
export const isHostNumber = (from: string, hostPhone: string) => digits(from) === digits(hostPhone);

export function applyReply(event: Event, from: string, body: string, now: Date): { outcome: ReplyOutcome; approval?: Approval } {
  if (!isHostNumber(from, event.hostPhone)) return { outcome: "wrong_sender" };
  const { verb, code } = parseReply(body);
  if (!verb || !code) return { outcome: "no_code" };
  const approval = event.approvals.find((a) => a.code === code && a.status === "pending") ?? event.approvals.find((a) => a.code === code);
  if (!approval) return { outcome: "unknown_code" };
  if (approval.status !== "pending") return { outcome: "already_answered", approval };
  if (now > new Date(approval.expiresAt)) {
    approval.status = "expired";
    return { outcome: "expired", approval };
  }
  approval.status = verb === "YES" ? "approved" : "declined";
  approval.answeredAt = now.toISOString();
  approval.answeredFrom = from;
  return { outcome: verb === "YES" ? "approved" : "declined", approval };
}
