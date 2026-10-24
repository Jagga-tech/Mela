import type { z } from "zod";
import { ServiceError } from "../service";

/** One fetch path for every live call: timeout, error normalization, and schema validation at the boundary. */
export async function requestJson<S extends z.ZodTypeAny>(path: string, schema: S, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    });
  } catch (e) {
    throw new ServiceError((e as Error).name === "TimeoutError" ? "The server took too long to answer." : "Couldn't reach the server.", "network");
  }
  const json = await res.json().catch(() => null);
  if (res.status === 404 || res.status === 501 || res.status === 503)
    throw new ServiceError(json?.error ?? `${path} isn't connected yet.`, "not_connected", res.status);
  if (res.status === 409 || res.status === 403 || res.status === 422) throw new ServiceError(json?.error ?? "The server refused this action.", "refused", res.status);
  if (!res.ok) throw new ServiceError(json?.error ?? `Server error (${res.status}).`, "server", res.status);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.error("[mela] invalid response from", path, parsed.error.issues.slice(0, 5));
    throw new ServiceError(`${path} returned data in an unexpected shape.`, "invalid_response");
  }
  return parsed.data;
}
