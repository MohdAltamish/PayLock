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
