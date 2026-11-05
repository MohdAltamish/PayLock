import { NON_RETRYABLE_ISSUES, parsePayPalError, PayPalError } from "./errors.js";
import type { FetchLike, TokenProvider } from "./token.js";

/**
 * The single HTTP path to PayPal (invariant 2).
 *
 * - Every POST must carry a PayPal-Request-Id; the same id is sent on every retry.
 * - Retries: up to 3 (4 tries total) on 429, 5xx, network errors/timeouts, and
 *   409 PREVIOUS_REQUEST_IN_PROGRESS. Exponential backoff with jitter from a
 *   500ms base; `Retry-After` is honored when longer.
 * - Never retried: other 4xx, including INSTRUMENT_DECLINED and TRANSACTION_REFUSED.
 * - A 401 invalidates the cached token and is retried once with a new token.
 * - Logs method, path, status, request id, attempt, duration and debug_id only.
 */

export interface PayPalRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | undefined>;
  /** JSON body; serialized with JSON.stringify. */
  body?: unknown;
  /** Pre-serialized JSON body. Used where exact bytes matter (webhook verification). */
  rawBody?: string;
  /** Required for POST. Reused on every retry. */
  requestId?: string;
  /** Send `Prefer: return=representation`. */
  representation?: boolean;
  /** Extra headers (e.g. PayPal-Mock-Response in sandbox negative tests). */
  headers?: Record<string, string>;
}

export interface PayPalResponse<T = unknown> {
  status: number;
  data: T;
  debugId: string | undefined;
  attempts: number;
}

/** Structured logger subset. Pino/Fastify loggers satisfy it. */
export interface PayPalLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
  debug(obj: object, msg: string): void;
}

export interface PayPalHttpOptions {
  baseUrl: string;
  tokens: TokenProvider;
  log?: PayPalLogger;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
}

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

export class PayPalHttp {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly log: PayPalLogger;

  constructor(private readonly opts: PayPalHttpOptions) {
    this.fetchImpl = opts.fetch ?? ((i, init) => fetch(i, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.maxDelayMs = opts.maxDelayMs ?? 30_000;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.log = opts.log ?? noopLog;
  }

  async request<T = unknown>(req: PayPalRequest): Promise<PayPalResponse<T>> {
    if (req.method === "POST" && !req.requestId) {
      throw new Error(`PayPal POST ${req.path} requires a PayPal-Request-Id (invariant 2)`);
    }
    if (req.body !== undefined && req.rawBody !== undefined) {
      throw new Error("Pass either body or rawBody, not both");
    }
    const url = this.url(req);
    const payload = req.rawBody ?? (req.body === undefined ? undefined : JSON.stringify(req.body));

    let tokenRefreshed = false;
    let retries = 0;
    for (let attempt = 1; ; attempt++) {
      const started = Date.now();
      const token = await this.opts.tokens.getToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(req.requestId ? { "PayPal-Request-Id": req.requestId } : {}),
        ...(req.representation ? { Prefer: "return=representation" } : {}),
        ...req.headers,
      };
      const logCtx = {
        method: req.method,
        path: req.path,
        paypal_request_id: req.requestId,
        attempt,
      };

      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: req.method,
          headers,
          body: payload,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        const e = err as Error;
        const kind =
          e.name === "TimeoutError" || e.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
        if (retries < this.maxRetries) {
          retries++;
          const delay = this.backoff(retries, null);
          this.log.warn(
            { ...logCtx, error: kind, retry_in_ms: delay },
            "paypal request failed; retrying",
          );
          await this.sleep(delay);
          continue;
        }
        const final = new PayPalError(
          0,
          kind,
          `PayPal ${req.method} ${req.path}: ${e.message}`,
          undefined,
          [],
          attempt,
        );
        this.log.error({ ...logCtx, paypal: final.toLog() }, "paypal request failed");
        throw final;
      }

      const debugId = res.headers.get("paypal-debug-id") ?? undefined;
      const text = await res.text();
      const data = text ? safeJson(text) : undefined;
      const ms = Date.now() - started;

      if (res.ok) {
        this.log.info(
          { ...logCtx, status: res.status, debug_id: debugId, ms },
          "paypal request ok",
        );
        return { status: res.status, data: data as T, debugId, attempts: attempt };
      }

      const error = parsePayPalError(res.status, data, debugId, attempt);

      if (res.status === 401 && !tokenRefreshed) {
        tokenRefreshed = true;
        this.opts.tokens.invalidate();
        this.log.warn(
          { ...logCtx, status: 401, debug_id: error.debugId },
          "paypal 401; refreshing token",
        );
        continue;
      }

      if (this.isRetryable(error) && retries < this.maxRetries) {
        retries++;
        const delay = this.backoff(retries, res.headers.get("retry-after"));
        this.log.warn(
          { ...logCtx, paypal: error.toLog(), retry_in_ms: delay, ms },
          "paypal request failed; retrying with the same PayPal-Request-Id",
        );
        await this.sleep(delay);
        continue;
      }

      this.log.error({ ...logCtx, paypal: error.toLog(), ms }, "paypal request failed");
      throw error;
    }
  }

  private isRetryable(e: PayPalError): boolean {
    if (NON_RETRYABLE_ISSUES.some((i) => e.hasIssue(i))) return false;
    if (e.status === 429 || e.status >= 500) return true;
    return e.status === 409 && e.hasIssue("PREVIOUS_REQUEST_IN_PROGRESS");
  }

  /** Exponential backoff with full jitter on top; Retry-After wins when longer. Capped. */
  private backoff(retry: number, retryAfter: string | null): number {
    const exp = this.baseDelayMs * 2 ** (retry - 1);
    const jitter = Math.floor(this.random() * this.baseDelayMs);
    const computed = exp + jitter;
    const fromHeader = parseRetryAfter(retryAfter);
    return Math.min(this.maxDelayMs, Math.max(computed, fromHeader ?? 0));
  }

  private url(req: PayPalRequest): string {
    const u = new URL(req.path, this.opts.baseUrl);
    for (const [k, v] of Object.entries(req.query ?? {}))
      if (v !== undefined) u.searchParams.set(k, v);
    return u.toString();
  }
}

/** Retry-After as delta-seconds or an HTTP date. Returns ms, or undefined if absent/invalid. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
}
