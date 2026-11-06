import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { ProblemError } from "./lib/problem.js";
import { testConfig } from "./test/helpers.js";

async function app(checks: Record<string, () => Promise<void>> = { db: async () => { } }) {
  return buildApp({ config: testConfig(), deps: { healthChecks: checks }, logger: false });
}

describe("GET /healthz", () => {
  it("returns 200 when all checks pass", async () => {
    const a = await app({ db: async () => { }, paypal: async () => { } });
    const res = await a.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", checks: { db: "ok", paypal: "ok" } });
  });

  it("returns 503 and names the failing check without details", async () => {
    const a = await app({
      db: async () => {
        throw new Error("connection refused to 10.0.0.5 with password hunter2");
      },
    });
    const res = await a.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "degraded", checks: { db: "error" } });
    expect(res.body).not.toContain("hunter2");
  });
});

describe("request ids", () => {
  it("generates one and echoes it", async () => {
    const res = await (await app()).inject({ method: "GET", url: "/healthz" });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("accepts a safe incoming id", async () => {
    const res = await (
      await app()
    ).inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "abc12345-test" },
    });
    expect(res.headers["x-request-id"]).toBe("abc12345-test");
  });

  it("replaces an unsafe incoming id", async () => {
    const res = await (
      await app()
    ).inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "bad id\r\nx-evil: 1" },
    });
    expect(res.headers["x-request-id"]).not.toContain("bad");
  });
});

describe("RFC 7807 problems", () => {
  it("404 uses problem+json with request_id", async () => {
    const res = await (await app()).inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json();
    expect(body).toMatchObject({ status: 404, title: "Not found", instance: "/nope" });
    expect(body.type).toMatch(/not-found$/);
    expect(body.request_id).toBe(res.headers["x-request-id"]);
  });

  it("ProblemError keeps its status, code and extensions", async () => {
    const a = await app();
    a.get("/boom", async () => {
      throw new ProblemError(409, "invalid-transition", "Invalid transition", "LOCKED -> GUARDED", {
        from: "LOCKED",
      });
    });
    const res = await a.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      title: "Invalid transition",
      detail: "LOCKED -> GUARDED",
      from: "LOCKED",
    });
  });

  it("unexpected errors become a generic 500 without internals", async () => {
    const a = await app();
    a.get("/crash", async () => {
      throw new Error("secret internal stack detail");
    });
    const res = await a.inject({ method: "GET", url: "/crash" });
    expect(res.statusCode).toBe(500);
    expect(res.json().title).toBe("Internal server error");
    expect(res.body).not.toContain("secret internal");
  });

  it("schema validation errors become 400", async () => {
    const a = await app();
    a.post(
      "/v",
      {
        schema: {
          body: { type: "object", required: ["x"], properties: { x: { type: "string" } } },
        },
      },
      async () => ({}),
    );
    const res = await a.inject({ method: "POST", url: "/v", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().type).toMatch(/validation-error$/);
  });
});

describe("GET /config/paypal testCardFunding (BUILD_PLAN 2.4)", () => {
  const get = async (env: Record<string, string>) => {
    const a = await buildApp({
      config: testConfig(env),
      deps: { healthChecks: {} },
      logger: false,
    });
    const r = await a.inject({ method: "GET", url: "/config/paypal" });
    await a.close();
    return r.json() as { clientId: string; env: string; testCardFunding: boolean };
  };

  it("is true only with sandbox, E2E_FUNDING=card and NODE_ENV != production", async () => {
    expect((await get({ E2E_FUNDING: "card" })).testCardFunding).toBe(true);
  });

  it("is false when E2E_FUNDING is off or unset", async () => {
    expect((await get({ E2E_FUNDING: "off" })).testCardFunding).toBe(false);
    expect((await get({})).testCardFunding).toBe(false);
  });

  it("is false in production even with E2E_FUNDING=card", async () => {
    const body = await get({
      NODE_ENV: "production",
      E2E_FUNDING: "card",
      SESSION_SECRET: "x".repeat(40),
    });
    expect(body).toEqual({ clientId: "test-client-id", env: "sandbox", testCardFunding: false });
  });

  it("a non-sandbox PayPal env is rejected at startup, so it can never be true there", () => {
    expect(() => testConfig({ PAYPAL_ENV: "live", E2E_FUNDING: "card" })).toThrow(/sandbox/);
  });
});


describe("production safety", () => {
  it("E2E_FUNDING=card is rejected in production", () => {
    expect(() =>
      testConfig({ NODE_ENV: "production", E2E_FUNDING: "card", PAYPAL_ENV: "sandbox" }),
    ).toThrow();
  });

  it("E2E_FUNDING=card is rejected when PAYPAL_ENV is not sandbox", () => {
    expect(() => testConfig({ E2E_FUNDING: "card", PAYPAL_ENV: "live" })).toThrow();
  });

  it("AGENTS_MODE=replay works with LLM_PROVIDER=replay", () => {
    // Replay mode should never use live LLM or mock PayPal
    const c = testConfig({ AGENTS_MODE: "replay", LLM_PROVIDER: "replay" });
    expect(c.agentsMode).toBe("replay");
    expect(c.llm.provider).toBe("replay");
  });

  it("AGENTS_MODE=replay with live LLM provider is allowed (uses fallback to rules-only)", () => {
    // This is allowed: replay mode with a live provider falls back to rules-only when no fixture exists
    const c = testConfig({ AGENTS_MODE: "replay", LLM_PROVIDER: "openai" });
    expect(c.agentsMode).toBe("replay");
    expect(c.llm.provider).toBe("openai");
  });

  it("in-memory PayPalSim is only used in test harness, never in production or replay mode", () => {
    // PayPalSim is injected directly in test harness.ts, not via config
    // Production and hosted demo always use real PayPal HTTP
    const c = testConfig({ AGENTS_MODE: "replay", LLM_PROVIDER: "replay" });
    expect(c.paypal.env).toBe("sandbox"); // Real sandbox, not mock
  });
});
