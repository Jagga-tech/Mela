import "server-only";
import type { Vendor } from "@/mela/contracts";
import { listJobs } from "@/lib/research/jobStore";
import { toSnapshot } from "@/lib/research/snapshot";

// Vendors come only from live research jobs on this server, exactly as the host saw
// them (src/lib/research/snapshot.ts). Never from fixtures, never from the client.


export interface FoundVendor {
  vendor: Vendor;
  jobId: string;
}

export function findResearchVendor(vendorId: string, briefId?: string): FoundVendor | null {
  const all = listJobs(); // newest first
  // A job for the same brief wins; vendor ids are derived from URLs so they repeat across jobs.
  const ordered = briefId ? [...all.filter((j) => j.brief.id === briefId), ...all.filter((j) => j.brief.id !== briefId)] : all;
  for (const job of ordered) {
    if (job.cancelled) continue;
    const vendor = toSnapshot(job).vendors.find((v) => v.id === vendorId);
    if (vendor) return { vendor, jobId: job.id };
  }
  return null;
}
