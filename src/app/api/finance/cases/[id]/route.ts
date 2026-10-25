import { getCase } from "@/lib/finance/caseStore";
import { FinanceError, handle } from "@/lib/finance/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/finance/cases/:id → FinanceCase
export async function GET(_req: Request, { params }: Params) {
  return handle(async () => {
    const fc = getCase((await params).id);
    if (!fc) throw new FinanceError(404, "This finance case isn't on this server (it may have restarted). Open it again.");
    return Response.json(fc);
  });
}
