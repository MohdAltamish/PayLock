/**
 * scripts/void-all.ts
 * 
 * Emergency script to void all pending authorizations. Allowed during a freeze.
 * Usage: npm run void-all [-- --dry-run]
 * 
 * Lists all deals in LOCKED state with valid authorizations and voids them.
 * Each void is logged with the PayPal debug_id.
 */
import { PrismaClient } from "@prisma/client";
import { loadConfig } from "../apps/api/src/config/env.js";
import { createPayPalAdapter } from "../apps/api/src/paypal/adapter.js";

const prisma = new PrismaClient();

async function main() {
  const config = loadConfig();
  const adapter = createPayPalAdapter({
    baseUrl: config.paypal.baseUrl,
    clientId: config.paypal.clientId,
    clientSecret: config.paypal.clientSecret,
  });

  const dryRun = process.argv.includes("--dry-run");

  // Find all LOCKED deals with a valid authorization
  const deals = await prisma.deal.findMany({
    where: {
      state: "LOCKED",
      authExpiresAt: { gt: new Date() },
    },
    include: {
      payments: {
        where: { kind: "authorize", paypalId: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  console.log(`Found ${deals.length} deal(s) with pending authorizations\n`);

  if (dryRun) {
    console.log("DRY RUN - would void these authorizations:\n");
    for (const d of deals) {
      const authId = d.payments[0]?.paypalId;
      console.log(`  Deal ${d.id.slice(-8)}: auth ${authId}`);
    }
    return;
  }

  let voided = 0;
  let failed = 0;

  for (const d of deals) {
    const authId = d.payments[0]?.paypalId;
    if (!authId) {
      console.log(`Deal ${d.id.slice(-8)}: no authorization ID found, skipping`);
      continue;
    }

    try {
      console.log(`Voiding auth ${authId} for deal ${d.id.slice(-8)}...`);
      await adapter.voidAuthorization(authId, `void-all-${d.id}`);

      // Update deal state
      await prisma.$transaction(async (tx) => {
        await tx.deal.update({
          where: { id: d.id },
          data: { state: "VOIDED", blockReason: "DEADLINE_PASSED" },
        });
        await tx.dealEvent.create({
          data: { dealId: d.id, type: "settlement.voided", data: { reason: "DEADLINE_PASSED" } },
        });
      });

      voided++;
      console.log(`  ✓ Voided`);
    } catch (err) {
      failed++;
      console.error(`  ✗ Failed: ${(err as Error).message}`);
    }
  }

  console.log(`\nDone. Voided: ${voided}, Failed: ${failed}`);
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
