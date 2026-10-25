import type { EventBrief, ResearchSnapshot } from "@/mela/contracts";
import type { JobRecord } from "@/lib/research/job";

export interface LiveResearch {
  brief: EventBrief;
  snapshot: ResearchSnapshot;
}

/**
 * The live research job for a brief, read from the research job store in this process.
 * With a jobId, that job (if it belongs to the brief). Without one, the most recently started job for the brief.
 *
 * The research modules are "server-only", so they are imported lazily: route tests swap this function out
 * (see deps.ts) and never load them.
 */
export async function findLiveResearch(briefId: string, jobId?: string): Promise<LiveResearch | undefined> {
  const store = await import("@/lib/research/jobStore");
  const { toSnapshot } = await import("@/lib/research/snapshot");
  let job: JobRecord | undefined;
  if (jobId) {
    job = store.getJob(jobId);
    if (job && job.brief.id !== briefId) job = undefined;
  } else {
    job = store.listJobs().find((j) => j.brief.id === briefId);
  }
  return job ? { brief: job.brief, snapshot: toSnapshot(job) } : undefined;
}
