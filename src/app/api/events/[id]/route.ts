import { store } from "@/lib/store";
import { redact } from "@/agents/harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const e = await store.getEvent((await params).id);
    return e ? Response.json(e) : Response.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    console.error(redact(String(err)));
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
