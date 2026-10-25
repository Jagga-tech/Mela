import { z } from "zod";
import { Actor, FinanceCase, ManagerDecision } from "@/mela/contracts";
import { getCase, saveCase } from "@/lib/finance/caseStore";
import { decide } from "@/lib/finance/cases";
import { financeDeps } from "@/lib/finance/deps";
import { FinanceError, handle, readJson } from "@/lib/finance/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The reason's length is checked by recordManagerDecision, so a short reason gets its sentence back.
const Body = z.object({ decision: ManagerDecision.shape.decision, reason: z.string().max(2000), actor: Actor });

// POST /api/finance/cases/:id/decisions {decision, reason, actor} → FinanceCase
export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const id = (await params).id;
    const fc = getCase(id);
    if (!fc) throw new FinanceError(404, "This finance case isn't on this server (it may have restarted). Open it again.");
    const body = Body.safeParse(await readJson(req));
    if (!body.success)
      throw new FinanceError(422, "Send { decision: approve_line | reject_line | ask_vendor, reason, actor } to decide.");
    const next = FinanceCase.parse(decide(fc, body.data, financeDeps().now()));
    saveCase(next);
    return Response.json(next);
  });
}
