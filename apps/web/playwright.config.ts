import { defineConfig } from "@playwright/test";

/**
 * E2E (Task 20). Real PayPal sandbox, funded server side with the sandbox test
 * card (BUILD_PLAN 2.4, C13), so no buyer popup is needed. The API and web
 * app run on 4100 / 3100 so they never collide with a dev server.
 * AGENTS for the API: E2E_AGENTS=replay (recorded fixtures) or stub (default
 * until fixtures exist; deterministic, no LLM).
 */
const API = "http://localhost:4100";
const WEB = "http://localhost:3100";
const agents = process.env.E2E_AGENTS ?? "stub";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: WEB, trace: "retain-on-failure" },
  testIgnore: process.env.E2E_POPUP ? [] : ["popup.spec.ts"],
  webServer: [
    {
      command: "npx tsx --env-file=../../.env ../api/src/server.ts",
      url: `${API}/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: "4100",
        AGENTS_MODE: agents,
        E2E_FUNDING: "card",
        APP_URL: WEB,
        API_URL: API,
        FETCH_URL_DEV_ALLOW_HOSTS: "localhost",
        SWEEPER_INTERVAL_MS: "2000",
        LOG_LEVEL: "warn",
      },
    },
    {
      command: "npx next build && npx next start -p 3100",
      url: WEB,
      reuseExistingServer: false,
      timeout: 240_000,
      env: { API_URL: API, NEXT_TELEMETRY_DISABLED: "1" },
    },
  ],
});
