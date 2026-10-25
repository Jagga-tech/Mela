// CRS Credit API transport: login, bearer token, timeouts, bounded retries.
//
// Every request shape here comes from CRS's published docs:
//   - POST /users/login {username, password} → {token, expires, refreshToken, ...}
//     (https://crscreditapi.redoc.ly/openapi/reference/tag/CRS/ , operation User-05)
//   - Product calls send `Authorization: Bearer <token>` and return a `RequestID` header.
//   - Errors are usually {timestamp, codes, messages, details}; 429 carries Retry-After.
//     (CRS CalHacks MCP server docs, @crscreditapi/crs-calhacks-mcp-server, products overview)
//
// No env reads here: config is injected (see ./config.ts, server-only). Nothing in
// this file logs a request or response body.

export const CRS_SANDBOX_BASE_URL = "https://api-sandbox.stitchcredit.com/api";

/** At most 2 attempts per CRS call (project rule). */
export const MAX_ATTEMPTS = 2;

export interface CrsClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Pause before the second attempt. */
  retryDelayMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export type CrsCallResult =
  | { ok: true; status: number; body: unknown; requestId?: string; latencyMs: number; attempts: number }
  | { ok: false; kind: CrsFailureKind; status?: number; message: string; requestId?: string; latencyMs: number; attempts: number };

/**
 * auth: login failed or the account can't use this product (CRS sends 401 for both).
 * refused: CRS rejected the input (4xx). unavailable: 5xx/503 from CRS or its data vendor.
 * timeout / network: no usable answer. bad_response: 2xx that isn't JSON.
 */
export type CrsFailureKind = "auth" | "refused" | "unavailable" | "timeout" | "network" | "rate_limited" | "bad_response";

/** Login failures are never retried: repeated failed logins disable the sandbox account. */
const loginLatch = (globalThis as typeof globalThis & { __melaCrsLoginFailure?: Map<string, string> });
const loginFailures = (loginLatch.__melaCrsLoginFailure ??= new Map<string, string>());

export class CrsClient {
  private token: string | null = null;
  private readonly opts: Required<Omit<CrsClientOptions, "log">> & { log: (line: string) => void };

  constructor(opts: CrsClientOptions) {
    this.opts = {
      timeoutMs: 15_000,
      retryDelayMs: 1_000,
      fetch: globalThis.fetch.bind(globalThis),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: (line) => console.info(line),
      ...opts,
      baseUrl: opts.baseUrl.replace(/\/+$/, ""),
    };
  }

  /** POST a JSON body to a CRS product route. `label` is used for logs only. */
  async post(path: string, body: unknown, label: string): Promise<CrsCallResult> {
    const started = Date.now();
    let attempts = 0;
    let relogged = false;
    let last: Extract<CrsCallResult, { ok: false }> | undefined;

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      const token = await this.login();
      if (!token.ok) return { ...token.failure, latencyMs: Date.now() - started, attempts };

      const res = await this.send(path, body, token.value);
      const latencyMs = Date.now() - started;

      if (res.kind === "response") {
        const { response } = res;
        const requestId = response.headers.get("RequestID") ?? undefined;
        if (response.ok) {
          const parsed = await response.json().then((b: unknown) => ({ ok: true as const, b }), () => ({ ok: false as const }));
          this.opts.log(`[crs] ${label} ${response.status} ${latencyMs}ms attempt=${attempts}${requestId ? ` req=${requestId}` : ""}`);
          if (!parsed.ok) return { ok: false, kind: "bad_response", status: response.status, message: "CRS answered with something that isn't JSON.", requestId, latencyMs, attempts };
          return { ok: true, status: response.status, body: parsed.b, requestId, latencyMs, attempts };
        }

        const message = await errorSummary(response);
        this.opts.log(`[crs] ${label} ${response.status} ${latencyMs}ms attempt=${attempts}${requestId ? ` req=${requestId}` : ""}`);

        if (response.status === 401 && !relogged) {
          // Token may have expired: log in again once, inside the same attempt budget.
          relogged = true;
          this.token = null;
          last = { ok: false, kind: "auth", status: 401, message: `CRS refused the token (401${message ? `: ${message}` : ""}).`, requestId, latencyMs, attempts };
          continue;
        }
        if (response.status === 401 || response.status === 403) {
          return { ok: false, kind: "auth", status: response.status, message: `This CRS account can't use this product (${response.status}${message ? `: ${message}` : ""}). Ask the CRS team to enable it.`, requestId, latencyMs, attempts };
        }
        if (response.status === 429) {
          last = { ok: false, kind: "rate_limited", status: 429, message: "CRS rate limit hit (429).", requestId, latencyMs, attempts };
          const wait = Math.min(5_000, Math.max(this.opts.retryDelayMs, retryAfterMs(response.headers.get("Retry-After"))));
          if (attempts < MAX_ATTEMPTS) await this.opts.sleep(wait);
          continue;
        }
        if (response.status >= 500) {
          last = { ok: false, kind: "unavailable", status: response.status, message: `CRS or its data provider is unavailable (${response.status}${message ? `: ${message}` : ""}).`, requestId, latencyMs, attempts };
          if (attempts < MAX_ATTEMPTS) await this.opts.sleep(this.opts.retryDelayMs);
          continue;
        }
        return { ok: false, kind: "refused", status: response.status, message: `CRS refused the request (${response.status}${message ? `: ${message}` : ""}).`, requestId, latencyMs, attempts };
      }

      this.opts.log(`[crs] ${label} ${res.kind} ${latencyMs}ms attempt=${attempts}`);
      last =
        res.kind === "timeout"
          ? { ok: false, kind: "timeout", message: `CRS didn't answer within ${Math.round(this.opts.timeoutMs / 1000)} s.`, latencyMs, attempts }
          : { ok: false, kind: "network", message: "Couldn't reach CRS (network error).", latencyMs, attempts };
      if (attempts < MAX_ATTEMPTS) await this.opts.sleep(this.opts.retryDelayMs);
    }

    const final = last ?? { ok: false as const, kind: "network" as const, message: "Couldn't reach CRS.", latencyMs: Date.now() - started, attempts };
    return { ...final, attempts, message: `${final.message} Tried ${attempts} time${attempts === 1 ? "" : "s"}.` };
  }

  private async login(): Promise<{ ok: true; value: string } | { ok: false; failure: Omit<Extract<CrsCallResult, { ok: false }>, "latencyMs" | "attempts"> }> {
    if (this.token) return { ok: true, value: this.token };
    const latched = loginFailures.get(this.latchKey());
    if (latched) return { ok: false, failure: { ok: false, kind: "auth", message: latched } };

    const res = await this.send("/users/login", { username: this.opts.username, password: this.opts.password });
    if (res.kind !== "response") {
      // Network trouble isn't a failed login, so it isn't latched.
      return { ok: false, failure: { ok: false, kind: res.kind, message: res.kind === "timeout" ? "CRS login timed out." : "Couldn't reach CRS to log in." } };
    }
    if (!res.response.ok) {
      const status = res.response.status;
      if (status >= 500) return { ok: false, failure: { ok: false, kind: "unavailable", status, message: `CRS login is unavailable (${status}).` } };
      const message = `CRS login failed (${status}). Not retrying until the server restarts, because repeated failed logins disable the sandbox account. Check CRS_USERNAME / CRS_PASSWORD.`;
      loginFailures.set(this.latchKey(), message);
      this.opts.log(`[crs] login ${status} (latched)`);
      return { ok: false, failure: { ok: false, kind: "auth", status, message } };
    }
    const body = (await res.response.json().catch(() => null)) as { token?: unknown } | null;
    if (!body || typeof body.token !== "string" || !body.token) {
      return { ok: false, failure: { ok: false, kind: "bad_response", message: "CRS login answered without a token." } };
    }
    this.token = body.token;
    return { ok: true, value: this.token };
  }

  private latchKey(): string {
    return `${this.opts.baseUrl}|${this.opts.username}`;
  }

  private async send(path: string, body: unknown, token?: string): Promise<{ kind: "response"; response: Response } | { kind: "timeout" | "network" }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await this.opts.fetch(`${this.opts.baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
      return { kind: "response", response };
    } catch {
      return { kind: controller.signal.aborted ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Test hook: forget latched login failures. */
export function resetCrsLoginLatch(): void {
  loginFailures.clear();
}

/** The CRS error code and first message, trimmed. Never the whole body. */
async function errorSummary(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { codes?: unknown; messages?: unknown } | null;
  if (!body || typeof body !== "object") return "";
  const code = Array.isArray(body.codes) && typeof body.codes[0] === "string" ? body.codes[0] : "";
  const msg = Array.isArray(body.messages) && typeof body.messages[0] === "string" ? body.messages[0] : "";
  return [code, msg].filter(Boolean).join(" ").slice(0, 160);
}

function retryAfterMs(header: string | null): number {
  if (!header) return 0;
  const s = Number(header);
  return Number.isFinite(s) ? s * 1000 : 0;
}
