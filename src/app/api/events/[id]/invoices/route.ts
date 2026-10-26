import { z } from "zod";
import { receiveInvoice } from "@/lib/events";
import { store } from "@/lib/store";
import { redact } from "@/agents/harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  vendorId: z.string().min(1),
  lineItems: z.array(z.object({ description: z.string(), qty: z.number().positive(), unitPriceUsd: z.number().nonnegative() })).min(1),
  terms: z.string(),
  paymentInstructions: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "vendorId, lineItems and terms are required" }, { status: 400 });
  try {
    const { id } = await params;
    if (!(await store.getEvent(id))) return Response.json({ error: "not found" }, { status: 404 });
    if (!(await store.getVendor(p.data.vendorId))) return Response.json({ error: "unknown vendor" }, { status: 400 });
    return Response.json(await receiveInvoice(id, p.data), { status: 201 });
  } catch (err) {
    console.error(redact(String(err)));
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
