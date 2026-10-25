import { z } from "zod";
import { FinanceCase } from "@/mela/contracts";
import { saveCase } from "@/lib/finance/caseStore";
import { openLiveCase } from "@/lib/finance/cases";
import { financeDeps } from "@/lib/finance/deps";
import { FinanceError, handle, readJson } from "@/lib/finance/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  briefId: z.string().trim().min(1),
  venueId: z.string().trim().min(1),
  /** Optional: the research job to quote from. Default: the most recent job for the brief. */
  jobId: z.string().trim().min(1).optional(),
});

// POST /api/finance/cases {briefId, venueId, jobId?} → FinanceCase
export async function POST(req: Request) {
  return handle(async () => {
    const body = Body.safeParse(await readJson(req));
    if (!body.success) throw new FinanceError(422, "Send { briefId, venueId } to open a finance case.");
    const deps = financeDeps();
    const research = await deps.findResearch(body.data.briefId, body.data.jobId);
    if (!research)
      throw new FinanceError(404, "There's no live research for this brief on this server (it may have restarted), so there's no published price to quote. Run the research again.");
    const fc = FinanceCase.parse(openLiveCase(research, body.data.venueId, deps.now()));
    saveCase(fc);
    return Response.json(fc);
  });
}
