import { getCall, respond } from "@/lib/calls/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ attemptId: string }> };

// GET /api/calls/:attemptId → {attempt, outcome|null}. The UI polls every 500 ms; Cartesia is polled at most every 1.5 s.
export async function GET(_req: Request, { params }: Params) {
  const { attemptId } = await params;
  return respond(() => getCall(attemptId));
}
