import { z } from "zod";
import { Actor, FinanceCase } from "@/mela/contracts";
import { getCase, saveCase } from "@/lib/finance/caseStore";
import { sendTestPayment } from "@/lib/finance/cases";
import { financeDeps } from "@/lib/finance/deps";
import { FinanceError, handle, readJson } from "@/lib/finance/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({ actor: Actor });

// POST /api/finance/cases/:id/test-payment {actor} → FinanceCase with testPayment.
// An explicit human action after a manager released the draft. Stripe TEST mode only: no real money moves.
export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const id = (await params).id;
    if (!getCase(id)) throw new FinanceError(404, "This finance case isn't on this server (it may have restarted). Open it again.");
    const body = Body.safeParse(await readJson(req));
    if (!body.success) throw new FinanceError(422, "Send { actor } (a human AP manager) to send a test payment.");
    const deps = financeDeps();
    const fc = await sendTestPayment(id, body.data.actor, {
      secretKey: process.env.STRIPE_SECRET_KEY,
      stripeCharge: deps.stripeCharge,
      vendorRiskGate: deps.vendorRiskGate,
      now: deps.now,
      load: getCase,
      save: saveCase,
    });
    return Response.json(FinanceCase.parse(fc));
  });
}
