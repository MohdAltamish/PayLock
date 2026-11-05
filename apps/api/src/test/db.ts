import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, inject } from "vitest";
import { TEST_DATABASE_URL } from "./db-url.js";

/** True when the global setup reached Postgres and migrated the test DB. */
export const dbAvailable = (): boolean => inject("dbAvailable");

let client: PrismaClient | undefined;

/** One client per DB test file, closed after the file. */
export function testDb(): PrismaClient {
  if (!client) {
    client = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
    afterAll(async () => {
      await client?.$disconnect();
      client = undefined;
    });
  }
  return client;
}

/** Empty every table (DB test files run one at a time). */
export async function resetDb(db: PrismaClient): Promise<void> {
  const tables = Object.values(Prisma.ModelName).map((m) => `"${m}"`);
  await db.$executeRawUnsafe(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
}

let seq = 0;

/** Minimal buyer, seller and policy (decision M values) for DB tests. */
export async function seedParties(db: PrismaClient) {
  seq += 1;
  const buyer = await db.user.create({
    data: {
      email: `buyer${seq}@example.test`,
      displayName: "Test Buyer",
      spendPolicy: {
        create: { maxPerDeal: "1000.00", dailyCap: "3000.00", approvalThreshold: "500.00" },
      },
    },
  });
  const seller = await db.user.create({
    data: {
      email: `seller${seq}@example.test`,
      displayName: "Test Seller",
      paypalEmail: `seller${seq}@example.test`,
      trustProfile: { create: { paypalVerified: true } },
    },
  });
  return { buyer, seller };
}

export async function createDeal(
  db: PrismaClient,
  data: { buyerId: string; sellerId: string } & Partial<Prisma.DealUncheckedCreateInput>,
) {
  return db.deal.create({ data: { amount: "100.00", ...data } });
}
