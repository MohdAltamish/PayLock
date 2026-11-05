import { PrismaClient } from "@prisma/client";
import { DEMO_BUYER, PERSONAS } from "../demo/personas.js";

/**
 * Seed demo users and personas (idempotent). With --reset, also delete demo
 * deals first (`npm run demo:reset`, decision L). Persona timestamps are
 * re-based on every run so the Guardian sees the same ages each demo.
 *
 * Reads PAYPAL_SANDBOX_SELLER_EMAIL for the payout address; it is never printed.
 */
const DAY = 86_400_000;

export async function resetDemoDeals(db: PrismaClient): Promise<number> {
  const deals = await db.deal.findMany({ where: { isDemo: true }, select: { id: true } });
  const ids = deals.map((d) => d.id);
  if (!ids.length) return 0;
  const where = { dealId: { in: ids } };
  await db.$transaction([
    db.dealEvent.deleteMany({ where }),
    db.auditLog.deleteMany({ where }),
    db.paymentRecord.deleteMany({ where }),
    db.policyDecision.deleteMany({ where }),
    db.decision.deleteMany({ where }),
    db.deliverable.deleteMany({ where }),
    db.riskAssessment.deleteMany({ where }),
    db.message.deleteMany({ where }),
    db.contract.deleteMany({ where }),
    db.deal.deleteMany({ where: { id: { in: ids } } }),
  ]);
  return ids.length;
}

export async function seed(
  db: PrismaClient,
  sellerPayoutEmail: string | undefined,
  now = new Date(),
) {
  const domain = sellerPayoutEmail?.split("@")[1] ?? "demo.paylock.dev";
  const buyer = await db.user.upsert({
    where: { email: `demo-buyer@buyers.paylock.dev` },
    create: {
      email: `demo-buyer@buyers.paylock.dev`,
      displayName: DEMO_BUYER.displayName,
      isDemo: true,
    },
    update: { displayName: DEMO_BUYER.displayName, isDemo: true },
  });
  // Decision M.
  const policy = {
    maxPerDeal: "1000.00",
    dailyCap: "3000.00",
    approvalThreshold: "500.00",
    allowMediumRisk: false,
  };
  await db.spendPolicy.upsert({
    where: { userId: buyer.id },
    create: { userId: buyer.id, ...policy },
    update: policy,
  });

  const sellers = [];
  for (const p of PERSONAS) {
    // Contact email on the payout account's domain, so PAYOUT_EMAIL_MISMATCH reflects real changes only.
    const email = `paylock-${p.key}@${domain}`;
    const user = await db.user.upsert({
      where: { email },
      create: {
        email,
        displayName: p.displayName,
        paypalEmail: sellerPayoutEmail ?? null,
        isDemo: true,
      },
      update: { displayName: p.displayName, paypalEmail: sellerPayoutEmail ?? null, isDemo: true },
    });
    const tp = {
      accountCreatedAt: new Date(now.getTime() - p.accountAgeDays * DAY),
      completedDeals: p.completedDeals,
      failedDeals: p.failedDeals,
      disputes: 0,
      reportsReceived: 0,
      payoutEmailChanges: p.payoutEmailChangedMinutesAgo === null ? 0 : 1,
      lastPayoutEmailChangeAt:
        p.payoutEmailChangedMinutesAgo === null
          ? null
          : new Date(now.getTime() - p.payoutEmailChangedMinutesAgo * 60_000),
      paypalVerified: p.paypalVerified,
    };
    await db.trustProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...tp },
      update: tp,
    });
    sellers.push({ key: p.key, id: user.id });
  }
  return { buyer: { id: buyer.id }, sellers };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    if (process.argv.includes("--reset"))
      console.log(`deleted ${await resetDemoDeals(db)} demo deal(s)`);
    const r = await seed(db, process.env.PAYPAL_SANDBOX_SELLER_EMAIL?.trim() || undefined);
    console.log(`buyer ${r.buyer.id}`);
    for (const s of r.sellers) console.log(`seller ${s.key} ${s.id}`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1])) void main();
