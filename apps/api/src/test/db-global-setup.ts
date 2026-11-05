import { execFileSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { TestProject } from "vitest/node";
import { TEST_DATABASE_URL } from "./db-url.js";

/**
 * Creates the Postgres test database if needed and applies migrations.
 * If Postgres is unreachable the DB suites are skipped with a warning, unless
 * REQUIRE_DB_TESTS=1 (CI), in which case the run fails.
 */
export default async function setup(project: TestProject) {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = "/postgres";
  const client = new PrismaClient({ datasourceUrl: admin.toString() });
  try {
    const rows = await client.$queryRaw<Array<{ n: number }>>`
      SELECT 1 AS n FROM pg_database WHERE datname = ${dbName}`;
    if (rows.length === 0) {
      if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`unsafe test db name ${dbName}`);
      await client.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    }
  } catch (err) {
    await client.$disconnect();
    if (process.env.REQUIRE_DB_TESTS === "1") throw err;
    console.warn(
      `\n[db tests] Postgres not reachable; DB suites skipped (${(err as Error).message.split("\n")[0]})\n`,
    );
    project.provide("dbAvailable", false);
    return;
  }
  await client.$disconnect();
  const root = path.resolve(import.meta.dirname, "../../../..");
  execFileSync(
    "npx",
    ["prisma", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"],
    { cwd: root, env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, stdio: "pipe" },
  );
  project.provide("dbAvailable", true);
}

declare module "vitest" {
  export interface ProvidedContext {
    dbAvailable: boolean;
  }
}
