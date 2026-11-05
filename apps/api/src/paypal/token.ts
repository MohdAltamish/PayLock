import { parsePayPalError, PayPalError } from "./errors.js";

/**
 * App access token via the OAuth 2.0 client-credentials grant (invariant 10).
 *
 * - HTTP Basic auth with client id and secret; credentials never in the body.
 * - Cached until 60s before `expires_in` (read from the response, never assumed).
 * - Concurrent callers share one in-flight fetch.
 * - The token is never logged or returned to clients. This is the app's own
 *   token; the coding assistant's toolkit token is never used.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TokenProviderOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  fetch?: FetchLike;
  now?: () => number;
  refreshSkewMs?: number;
  timeoutMs?: number;
}

export interface AccessToken {
  value: string;
  expiresAt: number;
  scopes: string[];
}

export class TokenProvider {
  private cached: AccessToken | undefined;
  private inflight: Promise<AccessToken> | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly skew: number;
  private readonly timeoutMs: number;

  constructor(private readonly opts: TokenProviderOptions) {
    this.fetchImpl = opts.fetch ?? ((i, init) => fetch(i, init));
    this.now = opts.now ?? Date.now;
    this.skew = opts.refreshSkewMs ?? 60_000;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /** A valid access token string, from cache when possible. */
  async getToken(): Promise<string> {
    return (await this.getAccessToken()).value;
  }

  async getAccessToken(): Promise<AccessToken> {
    if (this.cached && this.now() < this.cached.expiresAt - this.skew) return this.cached;
    this.inflight ??= this.fetchToken().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /** Drop the cache (e.g. after a 401) so the next call mints a new token. */
  invalidate(): void {
    this.cached = undefined;
  }

  private async fetchToken(): Promise<AccessToken> {
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64");
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new PayPalError(
        0,
        "NETWORK_ERROR",
        `Token request failed: ${(err as Error).message}`,
        undefined,
      );
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw parsePayPalError(res.status, body, res.headers.get("paypal-debug-id"));
    const value = body.access_token;
    const expiresIn = body.expires_in;
    if (typeof value !== "string" || typeof expiresIn !== "number" || expiresIn <= 0) {
      throw new PayPalError(
        res.status,
        "INVALID_TOKEN_RESPONSE",
        "Token response missing access_token or expires_in",
        res.headers.get("paypal-debug-id") ?? undefined,
      );
    }
    this.cached = {
      value,
      expiresAt: this.now() + expiresIn * 1000,
      scopes: typeof body.scope === "string" ? body.scope.split(" ") : [],
    };
    return this.cached;
  }
}
