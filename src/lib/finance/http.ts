// Errors the finance routes return. Status codes follow docs/frontend-integration.md §4:
// 404/501/503 = not connected, 403/409/422 = refused (the sentence is shown), anything else = server error.

export class FinanceError extends Error {
  override name = "FinanceError";
  constructor(public readonly status: number, message: string, public readonly extra?: Record<string, unknown>) {
    super(message);
  }
}

export const fail = (status: number, error: string, extra?: Record<string, unknown>) => Response.json({ error, ...extra }, { status });

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof FinanceError) return fail(err.status, err.message, err.extra);
    console.error("[finance] unexpected error", err);
    return fail(500, "The finance server hit an error. Nothing was paid. Try again.");
  }
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}
