import {
  AcceptanceCriterion,
  compareMoney,
  ContractOut,
  parseMoney,
  toMoney,
} from "@paylock/schemas";
import type { Deal, PrismaClient, TrustProfile, User } from "@prisma/client";
import { z } from "zod";
import type { Agents, CounterpartyProfile, GuardInput } from "../agents/types.js";
import { ProblemError } from "../lib/problem.js";
import type { PayPalLogger } from "../paypal/http.js";
import { committedToday, recordPolicyDecision } from "../policy/decisions.js";
import { evaluateGuard, guardPolicy } from "../policy/engine.js";
import type { Settlement } from "../settlement/settlement.js";
import { PERSONAS } from "../demo/personas.js";
import type { DealExecutor } from "./executor.js";
import { invalidState } from "./funding.js";
import { latestRecord } from "./payments.js";

/**
 * Deal orchestration outside of money movement: contract, messages, Guardian
 * gating, approvals, deliverables and the verification pipeline. Agents are
 * called outside DB transactions; their validated outputs are persisted and
 * acted on under the deal lock.
 */

export interface DealServiceDeps {
  db: PrismaClient;
  exec: DealExecutor;
  agents: Agents;
  settlement: Settlement;
  log: Pick<PayPalLogger, "info" | "warn" | "error">;
  /** Schedules background work (verification). Defaults to setImmediate. */
  defer?: (fn: () => Promise<void>) => void;
}

const HOUR = 3600_000;

export class DealService {
  private readonly inflight = new Set<Promise<void>>();

  constructor(private readonly d: DealServiceDeps) {}

  /** Resolves when background work (verification, settlement kicks) is done. Tests use it. */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  private background(fn: () => Promise<void>) {
    const run = async () => {
      try {
        await fn();
      } catch (err) {
        this.d.log.error({ err: (err as Error).message }, "background task failed");
      }
    };
    if (this.d.defer) {
      this.d.defer(run);
      return;
    }
    const p = new Promise<void>((resolve) => setImmediate(() => void run().finally(resolve)));
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }

  // ---------- create ----------

  async create(buyer: User, input: { sellerId: string; request: string }): Promise<Deal> {
    if (input.sellerId === buyer.id)
      throw new ProblemError(400, "bad-request", "You cannot hire yourself");
    const seller = await this.d.db.user.findUnique({ where: { id: input.sellerId } });
    if (!seller) throw new ProblemError(404, "not-found", "Seller not found");
    const policy = await this.d.db.spendPolicy.findUnique({ where: { userId: buyer.id } });
    if (!policy) throw new ProblemError(409, "no-policy", "Set a spend policy first");

    const { contract, modelMeta } = await this.d.agents.negotiate({ request: input.request });
    const parsed = ContractOut.parse(contract);
    if (compareMoney(parsed.price, "0.00") <= 0)
      throw new ProblemError(
        422,
        "no-price",
        "Add a price to the request",
        parsed.ambiguities.join("; "),
      );

    const deal = await this.d.db.deal.create({
      data: {
        buyerId: buyer.id,
        sellerId: seller.id,
        amount: parsed.price,
        currency: "USD",
        payoutEmail: seller.paypalEmail, // snapshot at contract time
        isDemo: buyer.isDemo && seller.isDemo,
        contract: {
          create: {
            title: parsed.title,
            scope: parsed.scope,
            criteria: parsed.criteria,
            deadline: parsed.deadline ? new Date(parsed.deadline) : null,
            partialPayMin: parsed.partialPayMin,
            rawRequest: input.request,
            modelMeta: { ...modelMeta, ambiguities: parsed.ambiguities },
          },
        },
      },
    });
    // Demo personas open the conversation with their scripted message (untrusted text).
    const persona = seller.isDemo ? personaForEmail(seller.email) : undefined;
    if (persona?.openingMessage)
      await this.d.db.message.create({
        data: { dealId: deal.id, authorId: seller.id, body: persona.openingMessage },
      });
    return this.d.exec.apply(
      deal.id,
      { type: "contract.created" },
      {
        actor: "AGENT",
        payload: {
          agent: "negotiator",
          title: parsed.title,
          price: parsed.price,
          criteria: parsed.criteria.length,
          ambiguities: parsed.ambiguities,
        },
      },
    );
  }

  async addMessage(deal: Deal, author: User, body: string) {
    if (deal.buyerId !== author.id && deal.sellerId !== author.id)
      throw new ProblemError(403, "forbidden", "Not a party to this deal");
    const msg = await this.d.db.message.create({
      data: { dealId: deal.id, authorId: author.id, body },
    });
    await this.d.exec.withDeal(deal.id, (l) =>
      l.append("message.added", {
        actor: "HUMAN",
        actorId: author.id,
        payload: { messageId: msg.id, from: deal.buyerId === author.id ? "buyer" : "seller" },
      }),
    );
    return msg;
  }

  // ---------- Guardian gating ----------

  async guard(dealId: string, actorId: string) {
    const deal = await this.d.db.deal.findUniqueOrThrow({
      where: { id: dealId },
      include: { contract: true, seller: { include: { trustProfile: true } }, messages: true },
    });
    if (deal.state !== "CONTRACTED") throw invalidState(deal, "run the risk check");
    const policy = await this.d.db.spendPolicy.findUniqueOrThrow({
      where: { userId: deal.buyerId },
    });
    const input = await this.guardInput(deal, toMoney(policy.approvalThreshold.toString()));
    const result = await this.d.agents.guard(input);

    return this.d.exec.withDeal(dealId, async (l) => {
      if (l.deal.state !== "CONTRACTED") throw invalidState(l.deal, "run the risk check");
      const risk = await l.tx.riskAssessment.create({
        data: {
          dealId,
          score: result.risk.score,
          level: result.risk.level,
          signals: result.risk.signals,
          summary: result.risk.summary,
          action: result.risk.recommendedAction,
          fallback: result.fallback,
        },
      });
      const p = await l.tx.spendPolicy.findUniqueOrThrow({ where: { userId: l.deal.buyerId } });
      const o = evaluateGuard({
        level: result.risk.level,
        amount: toMoney(l.deal.amount.toString()),
        policy: {
          maxPerDeal: toMoney(p.maxPerDeal.toString()),
          dailyCap: toMoney(p.dailyCap.toString()),
          approvalThreshold: toMoney(p.approvalThreshold.toString()),
          allowMediumRisk: p.allowMediumRisk,
        },
        committedToday: await committedToday(l.tx, l.deal.buyerId, this.d.exec.clock(), dealId),
      });
      const pd = await recordPolicyDecision(l.tx, dealId, o);
      const updated = await l.apply(
        {
          type: "risk.assessed",
          level: result.risk.level,
          policy: guardPolicy(o),
          policyCap: o.policyCap,
        },
        {
          actor: "AGENT",
          actorId,
          payload: {
            agent: "guardian",
            riskAssessmentId: risk.id,
            score: result.risk.score,
            level: result.risk.level,
            signals: result.risk.signals.map((s) => ({
              code: s.code,
              weight: s.weight,
              source: s.source,
            })),
            fallback: result.fallback,
            policy: o.result,
            policyReasons: o.reasons,
            policyDecisionId: pd.id,
          },
        },
      );
      return { deal: updated, risk, policy: o };
    });
  }

  private async guardInput(
    deal: Deal & {
      contract: { title: string; scope: string } | null;
      seller: User & { trustProfile: TrustProfile | null };
      messages: Array<{ authorId: string; body: string; createdAt: Date }>;
    },
    approvalThreshold: string,
  ): Promise<GuardInput> {
    const now = this.d.exec.clock();
    const tp = deal.seller.trustProfile;
    const seller: CounterpartyProfile = {
      accountAgeDays: tp ? (now.getTime() - tp.accountCreatedAt.getTime()) / (24 * HOUR) : 0,
      completedDeals: tp?.completedDeals ?? 0,
      failedDeals: tp?.failedDeals ?? 0,
      disputes: tp?.disputes ?? 0,
      reportsReceived: tp?.reportsReceived ?? 0,
      payoutEmailChanges: tp?.payoutEmailChanges ?? 0,
      hoursSincePayoutEmailChange: tp?.lastPayoutEmailChangeAt
        ? (now.getTime() - tp.lastPayoutEmailChangeAt.getTime()) / HOUR
        : null,
      paypalVerified: tp?.paypalVerified ?? false,
      contactDomain: domainOf(deal.seller.email),
      payoutDomain: domainOf(deal.payoutEmail),
    };
    const velocity10m = await this.d.db.deal.count({
      where: { sellerId: deal.sellerId, createdAt: { gte: new Date(now.getTime() - 10 * 60_000) } },
    });
    const lower = parseMoney(approvalThreshold).mul(0.95).toFixed(2);
    const nearThresholdDeals24h = await this.d.db.deal.count({
      where: {
        sellerId: deal.sellerId,
        createdAt: { gte: new Date(now.getTime() - 24 * HOUR) },
        amount: { gte: lower, lte: approvalThreshold },
      },
    });
    const messages = [...deal.messages]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((m) => ({
        author: m.authorId === deal.buyerId ? ("buyer" as const) : ("seller" as const),
        body: m.body,
      }));
    return {
      dealId: deal.id,
      amount: toMoney(deal.amount.toString()),
      approvalThreshold,
      contract: {
        title: deal.contract?.title ?? "",
        scope: deal.contract?.scope ?? "",
        price: toMoney(deal.amount.toString()),
      },
      seller,
      velocity10m,
      nearThresholdDeals24h,
      messages,
    };
  }

  async approve(dealId: string, actorId: string) {
    return this.d.exec.withDeal(dealId, async (l) => {
      const updated = await l.apply({ type: "buyer.approve" }, { actor: "HUMAN", actorId });
      return updated;
    });
  }

  async override(dealId: string, actorId: string, reason: string) {
    return this.d.exec.withDeal(dealId, async (l) => {
      const updated = await l.apply(
        { type: "buyer.override", reason },
        { actor: "HUMAN", actorId, payload: { reason } },
      );
      const risk = await l.tx.riskAssessment.findFirst({
        where: { dealId },
        orderBy: { createdAt: "desc" },
      });
      if (risk)
        await l.tx.riskAssessment.update({ where: { id: risk.id }, data: { overridden: true } });
      return updated;
    });
  }

  async cancel(dealId: string, actorId: string) {
    return this.d.exec.withDeal(dealId, async (l) => {
      if (l.deal.state === "FUNDING") {
        const auth = await latestRecord(l.tx, dealId, "AUTHORIZE");
        if (auth?.status === "PENDING")
          throw new ProblemError(
            409,
            "authorizing",
            "PayPal is authorizing this payment; try again shortly",
          );
      }
      return l.apply({ type: "buyer.cancel" }, { actor: "HUMAN", actorId });
    });
  }

  // ---------- deliverables and verification ----------

  async submitDeliverable(
    dealId: string,
    seller: User,
    input: { kind: "url" | "text" | "repo"; content: string; note?: string },
  ) {
    const deal = await this.d.db.deal.findUniqueOrThrow({ where: { id: dealId } });
    if (deal.sellerId !== seller.id)
      throw new ProblemError(403, "forbidden", "Only the seller can deliver");
    const updated = await this.d.exec.withDeal(dealId, async (l) => {
      const del = await l.tx.deliverable.create({
        data: { dealId, kind: input.kind, content: input.content, note: input.note ?? null },
      });
      return l.apply(
        { type: "seller.deliverable.submitted" },
        {
          actor: "HUMAN",
          actorId: seller.id,
          payload: { deliverableId: del.id, kind: input.kind },
        },
      );
    });
    this.background(() => this.runVerification(dealId));
    return updated;
  }

  /** DELIVERED -> VERIFYING -> Decision -> RELEASING | NEEDS_REVIEW | void. Safe to re-run (sweeper). */
  async runVerification(dealId: string): Promise<void> {
    const started = await this.d.exec.withDeal(dealId, async (l) => {
      if (l.deal.state !== "DELIVERED") return false;
      await l.apply(
        { type: "verifier.started" },
        { actor: "AGENT", payload: { agent: "verifier" } },
      );
      return true;
    });
    if (!started) return;
    const deal = await this.d.db.deal.findUniqueOrThrow({
      where: { id: dealId },
      include: { contract: true, deliverables: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    const del = deal.deliverables[0]!;
    const criteria = z.array(AcceptanceCriterion).parse(deal.contract?.criteria ?? []);
    const partialPayMin = deal.contract?.partialPayMin ?? 70;
    let result: Awaited<ReturnType<Agents["verify"]>>;
    try {
      result = await this.d.agents.verify({
        dealId,
        contract: {
          title: deal.contract!.title,
          scope: deal.contract!.scope,
          criteria,
          partialPayMin,
        },
        deliverable: { kind: del.kind, content: del.content, note: del.note },
      });
    } catch (err) {
      this.d.log.error({ deal_id: dealId, err: (err as Error).message }, "verifier crashed");
      result = { decision: null, modelMeta: { mode: "live", error: (err as Error).name } };
    }

    const next = await this.d.exec.withDeal(dealId, async (l) => {
      if (l.deal.state !== "VERIFYING") return l.deal.state;
      const dec = result.decision;
      const row = await l.tx.decision.create({
        data: dec
          ? {
              dealId,
              deliverableId: del.id,
              outcome: dec.outcome,
              score: dec.score,
              perCriterion: dec.perCriterion,
              reasoning: dec.reasoning,
              payoutPercent: dec.payoutPercent,
              needsHumanReview: dec.needsHumanReview,
            }
          : {
              dealId,
              deliverableId: del.id,
              outcome: "FAIL",
              score: 0,
              perCriterion: [],
              reasoning:
                "The verifier could not produce a valid decision. A person needs to review.",
              payoutPercent: 0,
              needsHumanReview: true,
            },
      });
      const meta = {
        actor: "AGENT" as const,
        payload: {
          agent: "verifier",
          decisionId: row.id,
          outcome: row.outcome,
          score: row.score,
          needsHumanReview: row.needsHumanReview,
          modelMeta: result.modelMeta,
        },
      };
      if (!dec) return (await l.apply({ type: "verifier.invalid" }, meta)).state;
      const updated = await l.apply(
        {
          type: "verifier.decided",
          outcome: dec.outcome,
          score: dec.score,
          partialPayMin,
          needsHumanReview: dec.needsHumanReview,
        },
        meta,
      );
      return updated.state;
    });
    if (next === "RELEASING") await this.d.settlement.release(dealId);
    else if (next === "VERIFYING")
      await this.d.settlement.voidAuthorization(dealId, "VERIFICATION_FAILED");
  }

  /** Human approve (release) or reject (void) of a verifier decision in NEEDS_REVIEW. */
  async decide(
    dealId: string,
    decisionId: string,
    actorId: string,
    action: "approve" | "reject",
    reason: string,
  ) {
    const next = await this.d.exec.withDeal(dealId, async (l) => {
      const dec = await l.tx.decision.findFirst({ where: { id: decisionId, dealId } });
      if (!dec) throw new ProblemError(404, "not-found", "Decision not found");
      await l.tx.decision.update({
        where: { id: dec.id },
        data: { overriddenBy: actorId, overrideReason: reason },
      });
      const meta = { actor: "HUMAN" as const, actorId, payload: { decisionId, reason } };
      return (
        await l.apply({ type: action === "approve" ? "human.approve" : "human.reject" }, meta)
      ).state;
    });
    if (action === "approve" && next === "RELEASING") await this.d.settlement.release(dealId);
    if (action === "reject") await this.d.settlement.voidAuthorization(dealId, "HUMAN_REJECTED");
  }
}

function personaForEmail(email: string) {
  const key = /^paylock-([a-z-]+)@/.exec(email)?.[1];
  return PERSONAS.find((p) => p.key === key);
}

function domainOf(email: string | null | undefined): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  return email && at > 0 ? email.slice(at + 1).toLowerCase() : null;
}
