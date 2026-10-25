import { createPlan, respond } from "@/lib/calls/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/calls/plans {brief, vendorId} → CallPlan. The vendor comes from a live research job on this server.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return respond(() => createPlan(body));
}
