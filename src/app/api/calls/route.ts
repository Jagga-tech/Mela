import { respond, startCall } from "@/lib/calls/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/calls {planId, approvalId} → {attempt, approval}. Re-runs checkCallGate on the
// server's stored approval, then places exactly one call to the role-play line.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return respond(() => startCall(body));
}
