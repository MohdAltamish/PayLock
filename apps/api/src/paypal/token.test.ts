import { describe, expect, it } from "vitest";
import { fakeFetch } from "../test/fake-fetch.js";
import { PayPalError } from "./errors.js";
import { TokenProvider } from "./token.js";

const BASE = "https://api-m.sandbox.paypal.com";

function provider(replies: Parameters<typeof fakeFetch>[0][number]["replies"], clock = { t: 0 }) {
  const f = fakeFetch([{ match: (u) => u === `${BASE}/v1/oauth2/token`, replies }]);
  const p = new TokenProvider({
    baseUrl: BASE,
    clientId: "cid",
    clientSecret: "csecret",
    fetch: f.fetch,
    now: () => clock.t,
  });
  return { p, calls: f.calls, clock };
}

const ok = (token: string, expiresIn = 100) => ({
  status: 200,
  body: { access_token: token, expires_in: expiresIn, scope: "s1 s2" },
});

describe("TokenProvider", () => {
  it("uses client credentials with HTTP Basic auth, not the body", async () => {
    const { p, calls } = provider([ok("t1")]);
    expect(await p.getToken()).toBe("t1");
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.method).toBe("POST");
    expect(c.headers.authorization).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    expect(c.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(c.body).toBe("grant_type=client_credentials");
    expect(c.body).not.toContain("csecret");
  });

  it("caches until 60s before expires_in, then refreshes", async () => {
    const { p, calls, clock } = provider([ok("t1", 100), ok("t2", 100)]);
    expect(await p.getToken()).toBe("t1");
    clock.t = 39_000; // 61s before expiry
    expect(await p.getToken()).toBe("t1");
    expect(calls).toHaveLength(1);
    clock.t = 40_000; // exactly 60s before expiry
    expect(await p.getToken()).toBe("t2");
    expect(calls).toHaveLength(2);
  });

  it("reads expires_in from the response instead of assuming a lifetime", async () => {
    const { p, clock, calls } = provider([ok("short", 61), ok("next", 61)]);
    await p.getToken();
    clock.t = 1_000;
    await p.getToken();
    expect(calls).toHaveLength(2);
  });

  it("shares one in-flight fetch across concurrent callers", async () => {
    const { p, calls } = provider([ok("t1")]);
    const tokens = await Promise.all([p.getToken(), p.getToken(), p.getToken()]);
    expect(tokens).toEqual(["t1", "t1", "t1"]);
    expect(calls).toHaveLength(1);
  });

  it("invalidate forces a new token", async () => {
    const { p, calls } = provider([ok("t1"), ok("t2")]);
    await p.getToken();
    p.invalidate();
    expect(await p.getToken()).toBe("t2");
    expect(calls).toHaveLength(2);
  });

  it("surfaces OAuth errors with debug id, without the secret", async () => {
    const { p } = provider([
      {
        status: 401,
        body: { error: "invalid_client", error_description: "Client Authentication failed" },
        headers: { "paypal-debug-id": "dbg1" },
      },
    ]);
    const err = await p.getToken().catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toMatchObject({ status: 401, paypalName: "invalid_client", debugId: "dbg1" });
    expect(String(err.message)).not.toContain("csecret");
  });

  it("does not cache a failed fetch", async () => {
    const { p } = provider([{ status: 503, body: {} }, ok("t2")]);
    await expect(p.getToken()).rejects.toBeInstanceOf(PayPalError);
    expect(await p.getToken()).toBe("t2");
  });

  it("rejects a malformed token response", async () => {
    const { p } = provider([{ status: 200, body: { access_token: "x" } }]);
    await expect(p.getToken()).rejects.toMatchObject({ paypalName: "INVALID_TOKEN_RESPONSE" });
  });

  it("wraps network failures", async () => {
    const { p } = provider([{ error: new TypeError("fetch failed") }]);
    await expect(p.getToken()).rejects.toMatchObject({ status: 0, paypalName: "NETWORK_ERROR" });
  });
});
