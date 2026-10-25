import { cancelJob } from "@/lib/research/job";
import { getJob } from "@/lib/research/jobStore";
import { toSnapshot } from "@/lib/research/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ jobId: string }> };

const gone = () =>
  Response.json({ error: "This research job isn't on this server (it may have restarted). Start the research again." }, { status: 404 });

export async function GET(_req: Request, { params }: Params) {
  const job = getJob((await params).jobId);
  return job ? Response.json(toSnapshot(job)) : gone();
}

export async function DELETE(_req: Request, { params }: Params) {
  const job = getJob((await params).jobId);
  if (!job) return gone();
  cancelJob(job);
  return Response.json({ ok: true });
}
