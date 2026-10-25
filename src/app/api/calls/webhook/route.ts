import { handleWebhook } from "@/lib/calls/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/calls/webhook: Cartesia agent webhook (call_started, call_turn, call_completed, call_failed).
// Verified with the x-webhook-secret header against CARTESIA_WEBHOOK_SECRET.
export async function POST(req: Request) {
  const { status, body } = await handleWebhook(req);
  return Response.json(body, { status });
}
