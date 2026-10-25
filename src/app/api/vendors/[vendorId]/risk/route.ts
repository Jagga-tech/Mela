import { z } from "zod";
import { CrsConfigError, getCrsConfig, getRisk, isFresh, runVendorRiskCheck, type BusinessIdentity } from "@/lib/crs";
import { getJob } from "@/lib/research/jobStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { params: Promise<{ vendorId: string }> };

// Business fields only. `.strict()` refuses anything else (owner names, SSNs, birth
// dates): Mela never sends personal data to CRS.
const Business = z
  .object({
    name: z.string().trim().min(2).max(200),
    street: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().regex(/^[A-Za-z]{2}$/, "state is a 2-letter code").optional(),
    zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "zip is 5 digits").optional(),
    phone: z.string().trim().max(30).optional(),
  })
  .strict();

const Body = z
  .object({
    /** Research job holding the vendor; used when `business` isn't sent. */
    jobId: z.string().min(1).optional(),
    /** The vendor's business as known. Wins over the research job's record. */
    business: Business.optional(),
    /** Run again even if a fresh result exists. */
    recheck: z.boolean().optional(),
  })
  .strict();

// POST /api/vendors/:vendorId/risk {jobId?, business?, recheck?} → VendorRisk
// A CRS failure is returned as status "not_checked" with the reason (200), never "clear".
export async function POST(req: Request, { params }: Params) {
  const { vendorId } = await params;
  try {
    getCrsConfig();
  } catch (err) {
    if (err instanceof CrsConfigError) return Response.json({ error: `CRS isn't connected: ${err.message}` }, { status: 503 });
    throw err;
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const extra = parsed.error.issues.flatMap((i) => (i.code === "unrecognized_keys" ? i.keys : []));
    const error = extra.length
      ? `Mela only sends business details to CRS (name, street, city, state, zip, phone). Remove: ${extra.join(", ")}.`
      : "Send { jobId } or { business: { name, city?, state?, street?, zip?, phone? } }.";
    return Response.json({ error }, { status: 422 });
  }
  const body = parsed.data;

  if (!body.recheck) {
    const cached = getRisk(vendorId);
    if (cached && cached.status === "checked" && isFresh(cached)) return Response.json(cached);
  }

  let business: BusinessIdentity | undefined = body.business;
  if (!business && body.jobId) {
    const job = getJob(body.jobId);
    if (!job) return Response.json({ error: "That research job isn't on this server (it may have restarted). Run the research again." }, { status: 409 });
    const vendor = job.vendors.get(vendorId);
    if (!vendor) return Response.json({ error: "That vendor isn't in this research job." }, { status: 422 });
    business = { name: vendor.name, ...cityState(job.brief.city), phone: vendor.phone };
  }
  if (!business) return Response.json({ error: "Tell Mela which business to check: send { jobId } or { business: { name, ... } }." }, { status: 422 });

  try {
    return Response.json(await runVendorRiskCheck(vendorId, business));
  } catch (err) {
    if (err instanceof CrsConfigError) return Response.json({ error: `CRS isn't connected: ${err.message}` }, { status: 503 });
    console.error("[crs] risk check crashed", vendorId, err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "The CRS check crashed on the server. This vendor is not checked." }, { status: 500 });
  }
}

// GET /api/vendors/:vendorId/risk → the latest VendorRisk on this server.
export async function GET(_req: Request, { params }: Params) {
  const risk = getRisk((await params).vendorId);
  return risk ? Response.json(risk) : Response.json({ error: "Mela hasn't checked this vendor with CRS yet." }, { status: 404 });
}

/** "San Francisco, CA" → {city, state}; a bare city stays a city. */
function cityState(raw: string): { city?: string; state?: string } {
  const [city, state] = raw.split(",").map((s) => s.trim());
  return { city: city || undefined, state: state && /^[A-Za-z]{2}$/.test(state) ? state.toUpperCase() : undefined };
}
