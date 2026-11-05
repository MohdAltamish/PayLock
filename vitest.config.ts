import { defineConfig } from "vitest/config";

// Two projects: fast unit tests run in parallel; `*.db.test.ts` files share
// one Postgres test database (TEST_DATABASE_URL) and run one file at a time.
export default defineConfig({
  test: {
    environment: "node",
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [
            "apps/*/src/**/*.test.ts",
            "packages/*/src/**/*.test.ts",
            "scripts/**/*.test.ts",
          ],
          exclude: ["**/*.db.test.ts", "**/node_modules/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["apps/*/src/**/*.db.test.ts"],
          globalSetup: ["apps/api/src/test/db-global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
