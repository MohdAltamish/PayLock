import { beforeEach, describe, expect, it } from "vitest";
import { createDeal, dbAvailable, resetDb, seedParties, testDb } from "../test/db.js";
import { ApprovalError } from "../paypal/approval.js";
import {
  committedToday,
  lockSpendPolicy,
  PolicyDecisionApproval,
  recordPolicyDecision,
} from "./decisions.js";
import { evaluateCapture } from "./engine.js";

describe.skipIf(!dbAvailable())("policy decisions (Postgres)", () => {
  const db = testDb();
  let p: Awaited<ReturnType<typeof seedParties>>;
  beforeEach(async () => {
    await resetDb(db);
    p = await seedParties(db);
  });

  it("committedToday counts today's deals in decision D states, for this buyer only", async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 36 * 3600_000);
    const mk = (state: string, amount: string, createdAt = now, buyerId = p.buyer.id) =>
      createDeal(db, { buyerId, sellerId: p.seller.id, state: state as never, amount, createdAt });
    await mk("LOCKED", "100.00");
    await mk("RELEASED", "200.00");
    await mk("SETTLEMENT_ERROR", "0.50");
    await mk("FUNDING", "400.00"); // not counted
    await mk("VOIDED", "800.00"); // not counted
    await mk("CANCELLED", "800.00"); // not counted
    await mk("LOCKED", "1000.00", yesterday); // not today
    const other = await seedParties(db);
    await mk("LOCKED", "999.00", now, other.buyer.id); // other buyer
    const excluded = await mk("LOCKED", "50.00");

    expect(await committedToday(db, p.buyer.id, now)).toBe("350.50");
    expect(await committedToday(db, p.buyer.id, now, excluded.id)).toBe("300.50");
  });

  it("lockSpendPolicy returns money strings", async () => {
    const policy = await db.$transaction((tx) => lockSpendPolicy(tx, p.buyer.id));
    expect(policy).toEqual({
      maxPerDeal: "1000.00",
      dailyCap: "3000.00",
      approvalThreshold: "500.00",
      allowMediumRisk: false,
    });
  });

  describe("PolicyDecisionApproval", () => {
    async function setup(result: "ALLOW" | "BLOCK" = "ALLOW", amount = "100.00") {
      const deal = await createDeal(db, { buyerId: p.buyer.id, sellerId: p.seller.id });
      const o = evaluateCapture({
        freeze: result === "BLOCK",
        amount,
        decision: { id: "dec", outcome: "PASS" },
        humanApproved: false,
        requiresHumanRelease: false,
        authExpiresAt: new Date(Date.now() + 3600_000),
        now: new Date(),
      });
      const pd = await db.$transaction((tx) => recordPolicyDecision(tx, deal.id, o, "dec"));
      return { deal, pd };
    }
    const attach = (
      dealId: string,
      policyDecisionId: string,
      amount = "100.00",
      status = "PENDING",
    ) =>
      db.paymentRecord.create({
        data: {
          dealId,
          kind: "CAPTURE",
          idempotencyKey: `k-${policyDecisionId}-${status}-${amount}`,
          policyDecisionId,
          amount,
          status: status as never,
        },
      });

    it("approves the exact deal, action and amount with a pending record", async () => {
      const { deal, pd } = await setup();
      await attach(deal.id, pd.id);
      await expect(
        new PolicyDecisionApproval(db, pd.id).assertApproves({
          dealId: deal.id,
          action: "capture",
          amount: "100.00",
        }),
      ).resolves.toBeUndefined();
    });

    it.each([
      ["another deal", { dealId: "other" }, /another deal/],
      ["another action", { action: "payout" as const }, /approves capture/],
      ["another amount", { amount: "100.01" }, /amount/],
    ])("refuses %s", async (_n, over, msg) => {
      const { deal, pd } = await setup();
      await attach(deal.id, pd.id);
      await expect(
        new PolicyDecisionApproval(db, pd.id).assertApproves({
          dealId: deal.id,
          action: "capture",
          amount: "100.00",
          ...over,
        }),
      ).rejects.toThrow(msg);
    });

    it("refuses a BLOCK decision", async () => {
      const { deal, pd } = await setup("BLOCK");
      await attach(deal.id, pd.id);
      await expect(
        new PolicyDecisionApproval(db, pd.id).assertApproves({
          dealId: deal.id,
          action: "capture",
          amount: "100.00",
        }),
      ).rejects.toThrow(/BLOCK/);
    });

    it("refuses without a PENDING record (already used or never written)", async () => {
      const { deal, pd } = await setup();
      const approval = new PolicyDecisionApproval(db, pd.id);
      const req = { dealId: deal.id, action: "capture" as const, amount: "100.00" };
      await expect(approval.assertApproves(req)).rejects.toThrow(/PENDING PaymentRecord/);
      await attach(deal.id, pd.id, "100.00", "SUCCEEDED");
      await expect(approval.assertApproves(req)).rejects.toBeInstanceOf(ApprovalError);
    });

    it("refuses an unknown id", async () => {
      await expect(
        new PolicyDecisionApproval(db, "missing").assertApproves({
          dealId: "d",
          action: "capture",
          amount: "1.00",
        }),
      ).rejects.toThrow(/not found/);
    });
  });
});
