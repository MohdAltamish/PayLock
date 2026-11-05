import { toMoney, type Money } from "@paylock/schemas";
import type { PaymentKind, PolicyDecision, PrismaClient } from "@prisma/client";
import type { Tx } from "../deals/executor.js";
import { normalize } from "../lib/canonical.js";
import {
  ApprovalError,
  type ApprovalRequest,
  type SettlementApproval,
} from "../paypal/approval.js";
import {
  DAILY_CAP_STATES,
  startOfUtcDay,
  type PolicyOutcome,
  type SpendPolicyInput,
} from "./engine.js";

/** Persist a policy outcome. Call inside the same transaction as the action it covers. */
export async function recordPolicyDecision(
  tx: Tx,
  dealId: string,
  o: PolicyOutcome,
  decisionId?: string | null,
): Promise<PolicyDecision> {
  return tx.policyDecision.create({
    data: {
      dealId,
      action: o.action,
      result: o.result,
      reasons: o.reasons,
      inputs: normalize(o.inputs) as object,
      decisionId: decisionId ?? null,
    },
  });
}

/**
 * Lock the buyer's SpendPolicy row so two concurrent fund/authorize calls for
 * the same buyer see each other's committed amounts (decision D re-check).
 */
export async function lockSpendPolicy(tx: Tx, buyerId: string): Promise<SpendPolicyInput> {
  await tx.$queryRaw`SELECT id FROM "SpendPolicy" WHERE "userId" = ${buyerId} FOR UPDATE`;
  const p = await tx.spendPolicy.findUnique({ where: { userId: buyerId } });
  if (!p) throw new ApprovalError("buyer has no spend policy");
  return {
    maxPerDeal: toMoney(p.maxPerDeal.toString()),
    dailyCap: toMoney(p.dailyCap.toString()),
    approvalThreshold: toMoney(p.approvalThreshold.toString()),
    allowMediumRisk: p.allowMediumRisk,
  };
}

/** Sum of today's (UTC) deals for this buyer in the cap-counting states. */
export async function committedToday(
  tx: Tx | PrismaClient,
  buyerId: string,
  now: Date,
  excludeDealId?: string,
): Promise<Money> {
  const agg = await tx.deal.aggregate({
    _sum: { amount: true },
    where: {
      buyerId,
      state: { in: [...DAILY_CAP_STATES] },
      createdAt: { gte: startOfUtcDay(now) },
      ...(excludeDealId ? { id: { not: excludeDealId } } : {}),
    },
  });
  return toMoney((agg._sum.amount ?? "0").toString());
}

const KIND_FOR_ACTION: Record<ApprovalRequest["action"], PaymentKind> = {
  capture: "CAPTURE",
  payout: "PAYOUT",
  refund: "REFUND",
};

/**
 * SettlementApproval backed by a persisted PolicyDecision (decision A). The
 * adapter calls assertApproves right before sending; it re-reads the row and
 * refuses unless it is an ALLOW for this deal and action, for this exact
 * amount, with a PENDING PaymentRecord of the matching kind attached.
 */
export class PolicyDecisionApproval implements SettlementApproval {
  constructor(
    private readonly db: PrismaClient,
    readonly id: string,
  ) {}

  async assertApproves(req: ApprovalRequest): Promise<void> {
    const row = await this.db.policyDecision.findUnique({
      where: { id: this.id },
      include: { payments: true },
    });
    if (!row) throw new ApprovalError(`PolicyDecision ${this.id} not found`);
    if (row.dealId !== req.dealId) throw new ApprovalError("PolicyDecision is for another deal");
    if (row.action !== req.action)
      throw new ApprovalError(`PolicyDecision approves ${row.action}, not ${req.action}`);
    if (row.result !== "ALLOW") throw new ApprovalError(`PolicyDecision result is ${row.result}`);
    const inputs = row.inputs as { amount?: unknown };
    if (inputs.amount !== req.amount)
      throw new ApprovalError("PolicyDecision amount does not match the request");
    const kind = KIND_FOR_ACTION[req.action];
    const pending = row.payments.find(
      (p) => p.kind === kind && p.status === "PENDING" && p.amount?.toFixed(2) === req.amount,
    );
    if (!pending)
      throw new ApprovalError("no PENDING PaymentRecord is attached to this PolicyDecision");
  }
}
