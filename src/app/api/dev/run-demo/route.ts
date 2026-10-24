import { createEvent, onInboundText } from "@/lib/events";
import { store } from "@/lib/store";
import { redact } from "@/agents/harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

const TEXT = "I'm planning an outdoor quinceañera in San Francisco for about 100 people, step-free access, some vegetarian guests, budget around $12,000, December 6 2026";

export async function POST() {
  if (process.env.NODE_ENV === "production") return Response.json({ error: "not found" }, { status: 404 });
  try {
    const hostPhone = process.env.MELA_HOST_PHONE ?? "+15550009999";
    const { id } = await createEvent(TEXT, hostPhone);
    const deadline = Date.now() + 180_000;
    let replied = false;
    for (;;) {
      const e = await store.getEvent(id);
      if (!e) return Response.json({ error: "not found" }, { status: 404 });
      if (e.status === "done" || e.status === "needs_planner" || Date.now() > deadline) return Response.json(e);
      const plan = e.approvals.find((a) => a.kind === "plan" && a.status === "pending");
      if (!replied && e.status === "awaiting_approval" && plan) {
        replied = true;
        await onInboundText(hostPhone, "YES " + plan.code);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (err) {
    console.error(redact(String(err)));
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
