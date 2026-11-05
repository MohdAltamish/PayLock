import { PrismaClient } from "@prisma/client";

let client: PrismaClient | undefined;

/** One PrismaClient per process. */
export function getDb(databaseUrl: string): PrismaClient {
  client ??= new PrismaClient({ datasourceUrl: databaseUrl });
  return client;
}

export async function closeDb(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}

/** Health probe: a trivial query with a timeout. */
export async function pingDb(db: PrismaClient, timeoutMs = 2000): Promise<void> {
  await withTimeout(db.$queryRaw`SELECT 1`, timeoutMs, "database ping timed out");
}

export async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
