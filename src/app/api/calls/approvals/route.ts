import { approve, respond } from "@/lib/calls/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/calls/approvals {planId, planVersion, scriptHash, approvedBy} → CallApproval (stored server-side, 15 min, one attempt).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return respond(() => approve(body));
}
