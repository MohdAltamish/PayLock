import { loadConfig, type Config } from "../config/env.js";

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "test-client-id",
    PAYPAL_CLIENT_SECRET: "test-client-secret",
    ...overrides,
  });
}
