import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./env.js";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  PAYPAL_ENV: "sandbox",
  PAYPAL_CLIENT_ID: "client-id",
  PAYPAL_CLIENT_SECRET: "super-secret-value",
};

describe("loadConfig", () => {
  it("parses a minimal valid env with defaults", () => {
    const c = loadConfig({ ...base });
    expect(c.port).toBe(4000);
    expect(c.paypal.baseUrl).toBe("https://api-m.sandbox.paypal.com");
    expect(c.freeze).toBe(false);
    expect(c.authSafeWindowHours).toBe(72);
    expect(c.paypal.webhookId).toBeUndefined();
  });

  it("treats empty optional strings as unset", () => {
    const c = loadConfig({ ...base, PAYPAL_WEBHOOK_ID: "", PAYPAL_PLATFORM_EMAIL: "  " });
    expect(c.paypal.webhookId).toBeUndefined();
    expect(c.paypal.platformEmail).toBeUndefined();
  });

  it("parses the freeze flag", () => {
    expect(loadConfig({ ...base, PAYLOCK_FREEZE: "1" }).freeze).toBe(true);
    expect(loadConfig({ ...base, PAYLOCK_FREEZE: "0" }).freeze).toBe(false);
    expect(() => loadConfig({ ...base, PAYLOCK_FREEZE: "yes" })).toThrow(ConfigError);
  });

  it("rejects anything but the sandbox environment", () => {
    expect(() => loadConfig({ ...base, PAYPAL_ENV: "live" })).toThrow(/PAYPAL_ENV/);
  });

  it("requires PayPal credentials", () => {
    expect(() => loadConfig({ ...base, PAYPAL_CLIENT_SECRET: "" })).toThrow(/PAYPAL_CLIENT_SECRET/);
  });

  it("requires a strong session secret in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
    expect(
      loadConfig({ ...base, NODE_ENV: "production", SESSION_SECRET: "x".repeat(32) }).sessionSecret,
    ).toHaveLength(32);
  });

  it("never includes secret values in error messages", () => {
    try {
      loadConfig({ ...base, PAYPAL_ENV: "live" });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain("super-secret-value");
    }
  });
});

describe("loadConfig: LLM and agents", () => {
  it("validates LLM_BASE_URL and keeps it", () => {
    const c = loadConfig({
      ...base,
      LLM_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
    expect(c.llm.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai/");
    expect(c.llm.jsonMode).toBe("json_schema");
    expect(() => loadConfig({ ...base, LLM_BASE_URL: "not a url" })).toThrow(/LLM_BASE_URL/);
  });
  it("requires https LLM_BASE_URL in production", () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: "production",
        SESSION_SECRET: "x".repeat(40),
        LLM_BASE_URL: "http://llm.internal/v1",
      }),
    ).toThrow(/https/);
  });
  it("live agents need a key and a model; replay does not", () => {
    expect(() => loadConfig({ ...base, AGENTS_MODE: "live" })).toThrow(/LLM_API_KEY/);
    expect(loadConfig({ ...base, AGENTS_MODE: "replay" }).agentsMode).toBe("replay");
    const c = loadConfig({ ...base, AGENTS_MODE: "live", LLM_API_KEY: "k", LLM_MODEL: "m" });
    expect(c.llm.model).toBe("m");
  });
  it("never allows loopback fetch hosts or run_checks in production", () => {
    const prod = {
      ...base,
      NODE_ENV: "production",
      SESSION_SECRET: "x".repeat(40),
      FETCH_URL_DEV_ALLOW_HOSTS: "localhost",
      RUN_CHECKS_ENABLED: "1",
    };
    expect(loadConfig(prod).fetchUrlDevAllowHosts).toEqual([]);
    expect(loadConfig(prod).runChecksEnabled).toBe(false);
    expect(
      loadConfig({ ...base, FETCH_URL_DEV_ALLOW_HOSTS: "localhost, 127.0.0.1" })
        .fetchUrlDevAllowHosts,
    ).toEqual(["localhost", "127.0.0.1"]);
  });
});
