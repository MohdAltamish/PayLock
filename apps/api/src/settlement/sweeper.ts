import type { PrismaClient } from "@prisma/client";
import type { DealExecutor } from "../deals/executor.js";
import type { FundingService } from "../deals/funding.js";
import { latestRecord } from "../deals/payments.js";
import type { PayPalLogger } from "../paypal/http.js";
import type { WebhookEventEnvelope } from "../webhooks/processor.js";
import type { Settlement } from "./settlement.js";

/**
 * Background sweeper (ARCHITECTURE 2.2). Each tick:
 * - drives RELEASING deals: polls GET capture until COMPLETED or DECLINED
 *   before any payout, resumes pending records with the same key, polls payouts;
 * - voids FAIL / rejected decisions whose void never ran;
 * - restarts verification stuck in DELIVERED;
 * - times out FUNDING, expires authorizations, voids overdue LOCKED deals;
 * - finishes PENDING authorizations and retries unprocessed webhooks.
 */
export interface SweeperDeps {
  db: PrismaClient;
  exec: DealExecutor;
  funding: FundingService;
  settlement: Settlement;
  verify: (dealId: string) => Promise<void>;
  reprocessWebhook: (event: WebhookEventEnvelope) => Promise<void>;
  fundingTimeoutMinutes: number;
  log: Pick<PayPalLogger, "info" | "warn" | "error">;
}

const STALE_MS = 30_000;

export class Sweeper {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly d: SweeperDeps) {}

  start(intervalMs: number) {
    if (intervalMs <= 0 || this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.d.exec.clock();
      const stale = new Date(now.getTime() - STALE_MS);
      const db = this.d.db;

      const releasing = await db.deal.findMany({
        where: { state: "RELEASING" },
        select: { id: true },
      });
      for (const { id } of releasing)
        await this.safe(id, "release", () => this.d.settlement.release(id));

      const funding = await db.deal.findMany({ where: { state: "FUNDING" } });
      for (const deal of funding) {
        const auth = await latestRecord(db, deal.id, "AUTHORIZE");
        const order = await latestRecord(db, deal.id, "ORDER");
        if (auth?.status === "PENDING") {
          await this.safe(deal.id, "authorization", () =>
            this.d.funding.refreshPendingAuthorization(deal.id),
          );
        } else if (order?.status === "PENDING" && order.updatedAt < stale) {
          await this.safe(deal.id, "order", () =>
            this.d.funding.resumeOrder(deal.id, deal.buyerId),
          );
        } else if (
          deal.updatedAt.getTime() <
          now.getTime() - this.d.fundingTimeoutMinutes * 60_000
        ) {
          await this.safe(deal.id, "funding timeout", () =>
            this.d.exec.apply(
              deal.id,
              { type: "funding.failed", reason: "FUNDING_TIMEOUT" },
              { actor: "SYSTEM", payload: { minutes: this.d.fundingTimeoutMinutes } },
            ),
          );
        }
      }

      // Decisions whose void never ran (crash between decision and void).
      const verifying = await db.deal.findMany({
        where: { state: { in: ["VERIFYING", "NEEDS_REVIEW"] }, updatedAt: { lt: stale } },
      });
      for (const deal of verifying) {
        const dec = await db.decision.findFirst({
          where: { dealId: deal.id },
          orderBy: { createdAt: "desc" },
        });
        if (!dec) continue;
        const rejected =
          deal.state === "NEEDS_REVIEW" &&
          (await db.dealEvent.count({
            where: { dealId: deal.id, type: "human.reject", createdAt: { gte: dec.createdAt } },
          })) > 0;
        const failed = deal.state === "VERIFYING";
        if (rejected || failed)
          await this.safe(deal.id, "void", () =>
            this.d.settlement.voidAuthorization(
              deal.id,
              rejected ? "HUMAN_REJECTED" : "VERIFICATION_FAILED",
            ),
          );
      }

      const delivered = await db.deal.findMany({
        where: { state: "DELIVERED", updatedAt: { lt: stale } },
        select: { id: true },
      });
      for (const { id } of delivered) await this.safe(id, "verify", () => this.d.verify(id));

      // Reservation expired (ADR-001): PayPal lets the authorization lapse; no void call.
      const expired = await db.deal.findMany({
        where: {
          state: { in: ["LOCKED", "DELIVERED", "VERIFYING", "NEEDS_REVIEW"] },
          authExpiresAt: { lt: now },
        },
        select: { id: true },
      });
      for (const { id } of expired)
        await this.safe(id, "expiry", () =>
          this.d.exec.apply(
            id,
            { type: "authorization.expired" },
            { actor: "SYSTEM", payload: { message: "Reservation expired" } },
          ),
        );

      const overdue = await db.deal.findMany({
        where: { state: "LOCKED", contract: { deadline: { lt: now } } },
        select: { id: true },
      });
      for (const { id } of overdue)
        await this.safe(id, "deadline", () =>
          this.d.settlement.voidAuthorization(id, "DEADLINE_PASSED"),
        );

      // Any other pending void or refund (including CANCELLED deals after ORDER_MISMATCH / POLICY_CAP).
      const pendingMoney = await db.paymentRecord.findMany({
        where: { kind: { in: ["VOID", "REFUND"] }, status: "PENDING", updatedAt: { lt: stale } },
        select: { dealId: true, kind: true },
      });
      for (const r of pendingMoney) {
        if (r.kind === "VOID") {
          const v = await latestRecord(db, r.dealId, "VOID");
          await this.safe(r.dealId, "void resume", () =>
            this.d.settlement.voidAuthorization(
              r.dealId,
              (v?.raw as { reason?: string })?.reason ?? "VERIFICATION_FAILED",
            ),
          );
        } else {
          await this.safe(r.dealId, "refund", () => this.d.settlement.refresh(r.dealId));
        }
      }

      const webhooks = await db.webhookEvent.findMany({
        where: { processedAt: null, attempts: { lt: 5 }, receivedAt: { lt: stale } },
        take: 20,
      });
      for (const w of webhooks)
        await this.safe(w.dealId ?? w.eventId, "webhook", () =>
          this.d.reprocessWebhook(w.raw as unknown as WebhookEventEnvelope),
        );
    } finally {
      this.running = false;
    }
  }

  private async safe(id: string, what: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (err) {
      this.d.log.warn(
        { deal_id: id, task: what, err: (err as Error).message },
        "sweeper task failed",
      );
    }
  }
}
