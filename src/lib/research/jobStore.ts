import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { JobRecord, Seed } from "./job";

// Research jobs live in this server process's memory. The poll has to reach the
// same process that runs the job, so the demo runs on one long-lived server
// (`next start`), not on serverless instances that can change between requests.
// Kept on globalThis so `next dev` hot reloads don't drop running jobs.

const MAX_JOBS = 50;

const g = globalThis as typeof globalThis & { __melaResearchJobs?: Map<string, JobRecord> };
const jobs = (g.__melaResearchJobs ??= new Map());

export function saveJob(job: JobRecord): void {
  jobs.set(job.id, job);
  // Oldest first in a Map, so drop from the front.
  while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value!);
}

export function getJob(id: string): JobRecord | undefined {
  return jobs.get(id);
}

/**
 * Seed venue URLs per city, from data/research-seeds.json. URLs and names only:
 * every fact still comes from a live read of the page.
 */
export function seedsFor(city: string, path = join(process.cwd(), "data/research-seeds.json")): Seed[] {
  let all: Record<string, Seed[]>;
  try {
    all = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  const key = city.toLowerCase().replace(/,.*$/, "").trim();
  return Array.isArray(all[key]) ? all[key]!.filter((s) => typeof s?.url === "string" && typeof s?.name === "string") : [];
}
