import type { Vendor } from "@/lib/types";
import { digits } from "@/integrations/phone";

export type FraudFinderResult = { risk: { score: number; tumbling_risk?: number;
  postal?: { first_name_match?: string; last_name_match?: string; deliverability?: string };
  phone?: { line_type?: string; status?: string; prepaid?: boolean } } };
export type ReverseResult = { success: boolean;
  data?: { records: { firstName: string; lastName: string; address?: string; city?: string; state?: string }[] } };
export type CrsClient = {
  fraudFinder(v: Vendor): Promise<FraudFinderResult>;
  reversePhone(v: Vendor): Promise<ReverseResult>;
};

// login `expires` format is not pinned down by the spec: epoch ms, epoch s, or seconds from now
const expiryMs = (expires: number, now: number) =>
  expires > 1e12 ? expires : expires > 1e9 ? expires * 1000 : now + expires * 1000;

// CRS (StitchCredit) sandbox: Fraud Finder plus reverse phone. Null when no credentials are set.
export function crsClient(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): CrsClient | null {
  const { CRS_USERNAME: username, CRS_PASSWORD: password } = env;
  if (!username || !password) return null;
  const base = env.CRS_BASE_URL || "https://api-sandbox.stitchcredit.com/api";
  const config = env.CRS_CONFIG || "fraud-finder";
  let token: string | null = null, expiresAt = 0;

  const post = (path: string, body: unknown, auth?: string) => fetchImpl(base + path, {
    method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
  });
  const fail = async (res: Response) => {
    const j = await res.json().catch(() => ({})) as { messages?: string[] };
    return new Error(`crs ${res.status} ${j.messages?.[0] ?? ""}`.trim());
  };
  const login = async () => {
    const res = await post("/users/login", { username, password });
    if (!res.ok) throw await fail(res);
    const j = await res.json() as { token: string; expires: number };
    token = j.token; expiresAt = expiryMs(j.expires, Date.now()) - 60_000;
    return token;
  };
  const call = async <T>(path: string, body: unknown): Promise<T> => {
    let res = await post(path, body, token && Date.now() < expiresAt ? token : await login());
    if (res.status === 401) res = await post(path, body, await login()); // token expired early: one retry
    if (!res.ok) throw await fail(res);
    return res.json() as Promise<T>;
  };
  const person = (v: Vendor) => ({ phoneNumber: digits(v.phone), firstName: v.contactFirstName, lastName: v.contactLastName });

  return {
    fraudFinder: (v) => call(`/fraud-finder/${config}`, { ...person(v), email: v.email ?? undefined, address: v.address ?? undefined }),
    reversePhone: (v) => call("/accurate-append/reverse", person(v)),
  };
}
