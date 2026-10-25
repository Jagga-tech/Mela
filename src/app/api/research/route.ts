import { after } from "next/server";
import { z } from "zod";
import { EventBrief } from "@/mela/contracts";
import { newId } from "@/mela/domain/util";
import { checkResearchConfig, ConfigError, getApifyToken } from "@/lib/research/config";
import { createJob, runJob } from "@/lib/research/job";
import { saveJob, seedsFor } from "@/lib/research/jobStore";
import { toSnapshot } from "@/lib/research/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ brief: EventBrief });

// POST /api/research {brief} → ResearchSnapshot. Starts the job and returns at
// once; the page then polls GET /api/research/:jobId.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send the event brief as { brief }." }, { status: 422 });
  const { brief } = parsed.data;
  if (!brief.confirmedAt) return Response.json({ error: "Confirm your brief before Mela starts researching." }, { status: 409 });
  if (!brief.city.trim()) return Response.json({ error: "Mela needs a city to research." }, { status: 422 });

  try {
    checkResearchConfig({ needSerp: true });
    getApifyToken();
    if (!process.env.ANTHROPIC_API_KEY) throw new ConfigError("ANTHROPIC_API_KEY is not set, so pages can't be read.");
  } catch (err) {
    if (err instanceof ConfigError) return Response.json({ error: `Live research isn't connected: ${err.message}` }, { status: 503 });
    throw err;
  }

  const job = createJob(newId("job"), brief);
  saveJob(job);
  after(() =>
    runJob(job, { seeds: seedsFor(brief.city) }).catch((err) => {
      console.error("[research] job failed", job.id, err);
    }),
  );
  return Response.json(toSnapshot(job));
}
