import { describe, expect, it } from "vitest";
import { fakeFetch, tokenRoute } from "../test/fake-fetch.js";
import { PayPalError, parsePayPalError } from "./errors.js";
import { PayPalHttp, parseRetryAfter } from "./http.js";
import { idempotencyKey } from "./idempotency.js";
import { TokenProvider } from "./token.js";

const BASE = "https://api-m.sandbox.paypal.com";
const CAPTURE = "/v2/payments/authorizations/AUTH1/capture";

type Replies = Parameters<typeof fakeFetch>[0][number]["replies"];

function client(replies: Replies, tokenReplies?: Replies) {
  const tr = tokenRoute();
  const f = fakeFetch([
    tokenReplies ? { match: tr.match, replies: tokenReplies } : tr,
    { match: (u) => u.startsWith(`${BASE}/v2/`) || u.startsWith(`${BASE}/v1/payments`), replies },
  ]);
  const sleeps: number[] = [];
  const tokens = new TokenProvider({
    baseUrl: BASE,
    clientId: "c",
    clientSecret: "s",
    fetch: f.fetch,
  });
  const http = new PayPalHttp({
    baseUrl: BASE,
    tokens,
    fetch: f.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0,
  });
  const api = () => f.calls.filter((c) => !c.url.endsWith("/v1/oauth2/token"));
  return { http, calls: f.calls, api, sleeps };
}

const post = {
  method: "POST" as const,
  path: CAPTURE,
  requestId: "key-1",
  body: { final_capture: true },
};
const err = (status: number, name: string, issue?: string, headers?: Record<string, string>) => ({
  status,
  body: {
    name,
    message: name,
    debug_id: `dbg-${status}`,
    ...(issue ? { details: [{ issue }] } : {}),
  },
  headers,
});

describe("PayPalHttp", () => {
  it("requires a PayPal-Request-Id on POST", async () => {
    const { http } = client([{ status: 201, body: {} }]);
    await expect(http.request({ method: "POST", path: CAPTURE, body: {} })).rejects.toThrow(
      /PayPal-Request-Id/,
    );
  });

  it("sends bearer token, request id, Prefer and JSON body", async () => {
    const { http, api } = client([{ status: 201, body: { id: "CAP1" } }]);
    const res = await http.request({ ...post, representation: true });
    expect(res).toMatchObject({ status: 201, data: { id: "CAP1" }, attempts: 1 });
    const c = api()[0]!;
    expect(c.headers.authorization).toBe("Bearer tok-1");
    expect(c.headers["paypal-request-id"]).toBe("key-1");
    expect(c.headers.prefer).toBe("return=representation");
    expect(c.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(c.body!)).toEqual({ final_capture: true });
  });

  it("retries 5xx 3 times with the same PayPal-Request-Id, then succeeds", async () => {
    const { http, api, sleeps } = client([
      err(500, "INTERNAL_SERVER_ERROR"),
      err(502, "BAD_GATEWAY"),
      err(503, "SERVICE_UNAVAILABLE"),
      { status: 201, body: { id: "CAP1" } },
    ]);
    const res = await http.request(post);
    expect(res.attempts).toBe(4);
    expect(api().map((c) => c.headers["paypal-request-id"])).toEqual([
      "key-1",
      "key-1",
      "key-1",
      "key-1",
    ]);
    expect(sleeps).toEqual([500, 1000, 2000]); // exponential, jitter 0 in test
  });

  it("gives up after 3 retries and reports debug_id and attempts", async () => {
    const { http, api } = client([err(500, "INTERNAL_SERVER_ERROR")]);
    const e = (await http.request(post).catch((x) => x)) as PayPalError;
    expect(e).toBeInstanceOf(PayPalError);
    expect(e).toMatchObject({ status: 500, debugId: "dbg-500", attempts: 4 });
    expect(api()).toHaveLength(4);
  });

  it("retries 429 and honors a longer Retry-After", async () => {
    const { http, sleeps } = client([
      err(429, "RATE_LIMIT_REACHED", undefined, { "retry-after": "7" }),
      { status: 201, body: {} },
    ]);
    await http.request(post);
    expect(sleeps).toEqual([7000]);
  });

  it("caps backoff at maxDelayMs", async () => {
    const { http, sleeps } = client([
      err(429, "RATE_LIMIT_REACHED", undefined, { "retry-after": "3600" }),
      { status: 201, body: {} },
    ]);
    await http.request(post);
    expect(sleeps).toEqual([30_000]);
  });

  it("retries 409 PREVIOUS_REQUEST_IN_PROGRESS with the same key", async () => {
    const { http, api } = client([
      err(409, "RESOURCE_CONFLICT", "PREVIOUS_REQUEST_IN_PROGRESS"),
      { status: 201, body: {} },
    ]);
    await http.request(post);
    expect(api().map((c) => c.headers["paypal-request-id"])).toEqual(["key-1", "key-1"]);
  });

  it.each([
    [422, "UNPROCESSABLE_ENTITY", "INSTRUMENT_DECLINED"],
    [422, "UNPROCESSABLE_ENTITY", "TRANSACTION_REFUSED"],
    [422, "UNPROCESSABLE_ENTITY", "AUTHORIZATION_ALREADY_CAPTURED"],
    [400, "INVALID_REQUEST", "MISSING_REQUIRED_PARAMETER"],
    [404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID"],
    [409, "RESOURCE_CONFLICT", "SOMETHING_ELSE"],
  ])("does not retry %i %s/%s", async (status, name, issue) => {
    const { http, api, sleeps } = client([err(status, name, issue)]);
    const e = (await http.request(post).catch((x) => x)) as PayPalError;
    expect(e).toMatchObject({ status, issue, attempts: 1 });
    expect(api()).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("retries network errors and timeouts", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    const { http, api } = client([
      { error: new TypeError("fetch failed") },
      { error: timeout },
      { status: 201, body: {} },
    ]);
    const res = await http.request(post);
    expect(res.attempts).toBe(3);
    expect(api().every((c) => c.headers["paypal-request-id"] === "key-1")).toBe(true);
  });

  it("reports a persistent timeout as TIMEOUT", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const { http } = client([{ error: timeout }]);
    await expect(http.request(post)).rejects.toMatchObject({
      status: 0,
      paypalName: "TIMEOUT",
      attempts: 4,
    });
  });

  it("on 401, refreshes the token once and retries", async () => {
    const tokenReplies: Replies = [
      { status: 200, body: { access_token: "old", expires_in: 32400 } },
      { status: 200, body: { access_token: "new", expires_in: 32400 } },
    ];
    const { http, api } = client(
      [err(401, "AUTHENTICATION_FAILURE"), { status: 200, body: { ok: true } }],
      tokenReplies,
    );
    const res = await http.request({ method: "GET", path: "/v2/payments/authorizations/AUTH1" });
    expect(res.status).toBe(200);
    expect(api().map((c) => c.headers.authorization)).toEqual(["Bearer old", "Bearer new"]);
  });

  it("does not loop on repeated 401", async () => {
    const { http, api } = client([err(401, "AUTHENTICATION_FAILURE")]);
    await expect(
      http.request({ method: "GET", path: "/v2/payments/authorizations/AUTH1" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(api()).toHaveLength(2);
  });

  it("sends rawBody bytes unchanged", async () => {
    const { http, api } = client([{ status: 200, body: { verification_status: "SUCCESS" } }]);
    const raw = '{"webhook_event": {"id":"WH-1",  "a" : 1 }}';
    await http.request({ method: "POST", path: "/v1/payments/x", requestId: "k", rawBody: raw });
    expect(api()[0]!.body).toBe(raw);
  });

  it("adds query parameters", async () => {
    const { http, api } = client([{ status: 200, body: {} }]);
    await http.request({
      method: "GET",
      path: "/v1/payments/payouts/B1",
      query: { fields: "batch_header", skip: undefined },
    });
    expect(api()[0]!.url).toBe(`${BASE}/v1/payments/payouts/B1?fields=batch_header`);
  });
});

describe("parsePayPalError", () => {
  it("prefers the body debug_id, falls back to the header", () => {
    expect(parsePayPalError(500, { name: "X", debug_id: "body" }, "hdr").debugId).toBe("body");
    expect(parsePayPalError(500, {}, "hdr").debugId).toBe("hdr");
  });

  it("exposes the first details issue", () => {
    const e = parsePayPalError(
      422,
      { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }] },
      null,
    );
    expect(e.issue).toBe("ORDER_NOT_APPROVED");
    expect(e.hasIssue("ORDER_NOT_APPROVED")).toBe(true);
  });

  it("handles non-JSON and empty bodies", () => {
    expect(parsePayPalError(502, undefined, null)).toMatchObject({ paypalName: "HTTP_502" });
  });

  it("toLog contains no body content", () => {
    const e = parsePayPalError(
      422,
      {
        name: "N",
        message: "payer email buyer@example.com",
        details: [{ issue: "I", description: "secret" }],
      },
      "d",
    );
    expect(JSON.stringify(e.toLog())).not.toMatch(/buyer@example.com|secret/);
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds and HTTP dates", () => {
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});

describe("idempotencyKey", () => {
  it("is sha256(dealId:action:attempt), stable and distinct per input", () => {
    const k = idempotencyKey("deal_1", "capture", 1);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(idempotencyKey("deal_1", "capture", 1)).toBe(k);
    expect(idempotencyKey("deal_1", "capture", 2)).not.toBe(k);
    expect(idempotencyKey("deal_1", "payout", 1)).not.toBe(k);
    expect(idempotencyKey("deal_2", "capture", 1)).not.toBe(k);
  });

  it("matches a known vector", () => {
    // echo -n "d1:capture:1" | shasum -a 256
    expect(idempotencyKey("d1", "capture", 1)).toBe(
      "003527cf31143f90cd6125ff6b2afa483ee9a23b47288262aae2199ede8ecbf3",
    );
  });

  it("rejects ambiguous inputs", () => {
    expect(() => idempotencyKey("a:b", "capture", 1)).toThrow();
    expect(() => idempotencyKey("d", "capture", 0)).toThrow();
    expect(() => idempotencyKey("", "capture", 1)).toThrow();
  });
});
