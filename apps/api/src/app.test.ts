import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { ProblemError } from "./lib/problem.js";
import { testConfig } from "./test/helpers.js";

async function app(checks: Record<string, () => Promise<void>> = { db: async () => {} }) {
  return buildApp({ config: testConfig(), deps: { healthChecks: checks }, logger: false });
}

describe("GET /healthz", () => {
  it("returns 200 when all checks pass", async () => {
    const a = await app({ db: async () => {}, paypal: async () => {} });
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
