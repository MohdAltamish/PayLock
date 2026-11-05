import { COPY, moneyEquals, toMoney } from "@paylock/schemas";
import type { Deal, PrismaClient } from "@prisma/client";
import { ProblemError } from "../lib/problem.js";
import type { PayPalLogger } from "../paypal/http.js";
import type { Authorization, Order } from "../paypal/types.js";
import type { SandboxMock } from "../paypal/adapter.js";
import { errorSummary, isOutcomeUnknown, type PayPalPort } from "../paypal/port.js";
import { PayPalError } from "../paypal/errors.js";
import { committedToday, lockSpendPolicy, recordPolicyDecision } from "../policy/decisions.js";
import { evaluateAuthorize, evaluateFund } from "../policy/engine.js";
import type { DealExecutor, LockedDeal } from "./executor.js";
import { createPending, json, latestRecord, mergeRaw, rawField } from "./payments.js";

/**
 * Funding: GUARDED -> FUNDING -> LOCKED (BUILD_PLAN 2.4, DESIGN section 3).
 *
 * - /fund is idempotent: an existing order is returned; a pending one is
 *   resumed with the same PayPal-Request-Id.
 * - /authorize never trusts a client order id. It GETs the stored order and
 *   checks status APPROVED, amount, currency and custom_id, authorizes, then
 *   checks the authorization amount and re-checks the daily cap inside the
 *   LOCKED transaction. A mismatch or cap breach voids the new authorization
 *   and cancels the deal with the reason.
 */

export interface Voider {
  voidAuthorization(dealId: string, reason: string): Promise<void>;
}

export interface FundingDeps {
  db: PrismaClient;
  exec: DealExecutor;
  paypal: PayPalPort;
  voider: Voider;
  isFrozen: () => boolean;
  appUrl: string;
  authSafeWindowHours: number;
  log: Pick<PayPalLogger, "info" | "warn" | "error">;
}

/** Sandbox test Visa (public test data, also in the toolkit's webhook guide). Test route only. */
export const SANDBOX_TEST_CARD = {
  number: "4111111111111111",
  expiry: "2030-12",
  name: "Paylock E2E",
  security_code: "123",
};

export class FundingService {
  constructor(private readonly d: FundingDeps) {}

  // ---------- /fund ----------

  async fund(dealId: string, actorId: string): Promise<{ orderId: string; approveUrl?: string }> {
    const step = await this.d.exec.withDeal(dealId, async (l) => {
      if (l.deal.state === "FUNDING") {
        const rec = await latestRecord(l.tx, dealId, "ORDER");
        if (rec?.status === "SUCCEEDED") return { kind: "existing" as const, rec };
        if (rec?.status === "PENDING") return { kind: "resume" as const, rec };
      } else if (l.deal.state !== "GUARDED") {
        throw invalidState(l.deal, "fund");
      }
      return this.openFunding(l, actorId, "paypal");
    });

    if (step.kind === "existing") {
      return {
        orderId: step.rec.paypalId!,
        approveUrl: rawField<string>(step.rec, "approveUrl"),
      };
    }
    const deal = await this.d.db.deal.findUniqueOrThrow({
      where: { id: dealId },
      include: { contract: true },
    });
    try {
      const { order, approveUrl } = await this.d.paypal.createOrder({
        dealId,
        amount: toMoney(deal.amount.toString()),
        description: deal.contract?.title ?? "Paylock deal",
        requestId: step.rec.idempotencyKey,
        returnUrl: `${this.d.appUrl}/deals/${dealId}?paypal=return`,
        cancelUrl: `${this.d.appUrl}/deals/${dealId}?paypal=cancel`,
      });
      await this.d.exec.withDeal(dealId, async (l) => {
        await l.tx.paymentRecord.update({
          where: { id: step.rec.id },
          data: {
            status: "SUCCEEDED",
            paypalId: order.id,
            paypalStatus: order.status,
            raw: mergeRaw(step.rec, { orderId: order.id, status: order.status, approveUrl }),
          },
        });
        await l.update({ paypalOrderId: order.id }, { actor: "SYSTEM" }, "paypal.order.stored");
        await l.append("paypal.order.ready", {
          actor: "PAYPAL",
          payload: { orderId: order.id, status: order.status },
        });
      });
      return { orderId: order.id, approveUrl };
    } catch (err) {
      await this.recordWriteError(step.rec.id, err);
      throw paypalProblem(err, "Could not create the PayPal order");
    }
  }

  // ---------- /authorize ----------

  async authorize(dealId: string, _actorId: string): Promise<Deal> {
    const deal = await this.d.db.deal.findUnique({ where: { id: dealId } });
    if (!deal) throw new ProblemError(404, "not-found", "Deal not found");
    const authRec = await latestRecord(this.d.db, dealId, "AUTHORIZE");
    if (authRec?.status === "SUCCEEDED" || deal.state !== "FUNDING") {
      if (authRec?.status === "SUCCEEDED") return deal; // idempotent replay of onApprove
      throw invalidState(deal, "authorize");
    }
    if (!deal.paypalOrderId)
      throw new ProblemError(409, "no-order", "Reserve funds first", "No PayPal order is stored");
    if (authRec?.status === "PENDING" && authRec.paypalId) {
      // PayPal returned a PENDING authorization; the reconciler finishes it.
      await this.refreshPendingAuthorization(dealId);
      return this.d.db.deal.findUniqueOrThrow({ where: { id: dealId } });
    }

    // The client may send an orderId; it is ignored. Only the stored one is used.
    const order = await this.d.paypal.getOrder(deal.paypalOrderId);
    const existing = order.purchase_units?.[0]?.payments?.authorizations?.[0];
    const problems = checkOrder(order, deal, existing ? ["APPROVED", "COMPLETED"] : ["APPROVED"]);
    if (problems.length) {
      await this.d.exec.withDeal(dealId, async (l) => {
        if (l.deal.state !== "FUNDING") return;
        await l.apply(
          { type: "funding.failed", reason: "ORDER_MISMATCH" },
          { actor: "SYSTEM", payload: { problems, alert: true } },
          existing ? { paypalAuthId: existing.id } : {},
        );
      });
      if (existing) await this.d.voider.voidAuthorization(dealId, "ORDER_MISMATCH");
      throw new ProblemError(
        409,
        "order-mismatch",
        "PayPal order does not match the deal",
        problems.join("; "),
      );
    }

    const rec =
      authRec?.status === "PENDING"
        ? authRec
        : await this.d.exec.withDeal(dealId, async (l) => {
            if (l.deal.state !== "FUNDING") throw invalidState(l.deal, "authorize");
            const policy = await lockSpendPolicy(l.tx, l.deal.buyerId);
            const o = evaluateAuthorize({
              freeze: this.d.isFrozen(),
              amount: toMoney(l.deal.amount.toString()),
              policy,
              committedToday: await committedToday(l.tx, l.deal.buyerId, this.now(), dealId),
            });
            const pd = await recordPolicyDecision(l.tx, dealId, o);
            if (o.result !== "ALLOW") return { blocked: o };
            return createPending(l.tx, {
              dealId,
              kind: "AUTHORIZE",
              amount: toMoney(l.deal.amount.toString()),
              policyDecisionId: pd.id,
            });
          });
    if ("blocked" in rec) {
      if (rec.blocked.policyCap) {
        await this.d.exec.apply(
          dealId,
          { type: "funding.failed", reason: "POLICY_CAP" },
          { actor: "SYSTEM", payload: { reasons: rec.blocked.reasons } },
        );
        throw new ProblemError(
          409,
          "policy-cap",
          "Spend limit reached",
          rec.blocked.reasons.join(", "),
        );
      }
      throw new ProblemError(503, "frozen", "Payments are paused", "PAYLOCK_FREEZE is on");
    }

    let authorization: Authorization;
    if (existing) {
      authorization = existing;
    } else {
      try {
        ({ authorization } = await this.d.paypal.authorizeOrder(
          deal.paypalOrderId,
          rec.idempotencyKey,
        ));
      } catch (err) {
        if (isOutcomeUnknown(err)) {
          await this.recordWriteError(rec.id, err);
          throw paypalProblem(err, "PayPal did not confirm the authorization");
        }
        await this.declined(dealId, rec.id, err);
        throw paypalProblem(err, "PayPal declined the authorization");
      }
    }
    await this.finishAuthorization(dealId, rec.id, authorization, order);
    return this.d.db.deal.findUniqueOrThrow({ where: { id: dealId } });
  }

  // ---------- test-only card funding (BUILD_PLAN 2.4, C13) ----------

  async fundWithCard(dealId: string, actorId: string, mock?: SandboxMock): Promise<Deal> {
    const step = await this.d.exec.withDeal(dealId, async (l) => {
      if (l.deal.state !== "GUARDED") throw invalidState(l.deal, "fund");
      return this.openFunding(l, actorId, "card");
    });
    const deal = await this.d.db.deal.findUniqueOrThrow({
      where: { id: dealId },
      include: { contract: true },
    });
    let order: Order;
    try {
      ({ order } = await this.d.paypal.createOrder({
        dealId,
        amount: toMoney(deal.amount.toString()),
        description: deal.contract?.title ?? "Paylock deal",
        requestId: step.rec.idempotencyKey,
        returnUrl: `${this.d.appUrl}/deals/${dealId}?paypal=return`,
        cancelUrl: `${this.d.appUrl}/deals/${dealId}?paypal=cancel`,
        card: SANDBOX_TEST_CARD,
        mock,
      }));
    } catch (err) {
      if (isOutcomeUnknown(err)) {
        await this.recordWriteError(step.rec.id, err);
        throw paypalProblem(err, "Could not create the PayPal order");
      }
      await this.d.exec.withDeal(dealId, async (l) => {
        await l.tx.paymentRecord.update({
          where: { id: step.rec.id },
          data: { status: "FAILED", error: json(errorSummary(err)) },
        });
        await l.apply(
          { type: "funding.failed", reason: "AUTH_DECLINED" },
          { actor: "PAYPAL", payload: paypalReason(err) },
        );
      });
      return this.d.db.deal.findUniqueOrThrow({ where: { id: dealId } });
    }
    await this.d.exec.withDeal(dealId, async (l) => {
      await l.tx.paymentRecord.update({
        where: { id: step.rec.id },
        data: { status: "SUCCEEDED", paypalId: order.id, paypalStatus: order.status },
      });
      await l.update({ paypalOrderId: order.id }, { actor: "SYSTEM" }, "paypal.order.stored");
    });
    const full = order.purchase_units?.[0]?.payments?.authorizations?.[0]
      ? order
      : await this.d.paypal.getOrder(order.id);
    const authorization = full.purchase_units?.[0]?.payments?.authorizations?.[0];
    const problems = checkOrder(full, deal, ["COMPLETED"]);
    if (!authorization) problems.push("card order has no authorization");
    const rec = await this.d.exec.withDeal(dealId, async (l) => {
      const policy = await lockSpendPolicy(l.tx, l.deal.buyerId);
      const o = evaluateAuthorize({
        freeze: false, // the authorization already exists; tx2 re-checks the cap
        amount: toMoney(l.deal.amount.toString()),
        policy,
        committedToday: await committedToday(l.tx, l.deal.buyerId, this.now(), dealId),
      });
      const pd = await recordPolicyDecision(l.tx, dealId, o);
      return createPending(l.tx, {
        dealId,
        kind: "AUTHORIZE",
        amount: toMoney(l.deal.amount.toString()),
        policyDecisionId: pd.id,
        raw: { source: "card-order" },
      });
    });
    if (!authorization) {
      await this.d.exec.apply(
        dealId,
        { type: "funding.failed", reason: "ORDER_MISMATCH" },
        { actor: "SYSTEM", payload: { problems, alert: true } },
      );
      return this.d.db.deal.findUniqueOrThrow({ where: { id: dealId } });
    }
    await this.finishAuthorization(dealId, rec.id, authorization, full, problems);
    return this.d.db.deal.findUniqueOrThrow({ where: { id: dealId } });
  }

  // ---------- shared ----------

  /** Writes PolicyDecision(fund) + a pending ORDER record + GUARDED -> FUNDING in one transaction. */
  private async openFunding(l: LockedDeal, actorId: string, via: "paypal" | "card") {
    const policy = await lockSpendPolicy(l.tx, l.deal.buyerId);
    const o = evaluateFund({
      state: "GUARDED",
      freeze: this.d.isFrozen(),
      amount: toMoney(l.deal.amount.toString()),
      policy,
      committedToday: await committedToday(l.tx, l.deal.buyerId, this.now(), l.deal.id),
    });
    const pd = await recordPolicyDecision(l.tx, l.deal.id, o);
    if (o.result !== "ALLOW") {
      if (o.reasons.includes("FROZEN"))
        throw new ProblemError(503, "frozen", "Payments are paused", "PAYLOCK_FREEZE is on");
      throw new ProblemError(409, "policy-cap", "Spend limit reached", o.reasons.join(", "));
    }
    const rec = await createPending(l.tx, {
      dealId: l.deal.id,
      kind: "ORDER",
      amount: toMoney(l.deal.amount.toString()),
      policyDecisionId: pd.id,
      raw: { via },
    });
    if (l.deal.state === "GUARDED") {
      await l.apply(
        { type: "paypal.order.created", policyAllowed: true },
        { actor: "HUMAN", actorId, payload: { policyDecisionId: pd.id, via } },
      );
    } else {
      await l.append("funding.retry", {
        actor: "HUMAN",
        actorId,
        payload: { attempt: rec.attempt },
      });
    }
    return { kind: "new" as const, rec };
  }

  /**
   * Record the authorization PayPal returned and move FUNDING forward. Used by
   * /authorize, the card route and the reconciler (GET-based). Idempotent.
   */
  async finishAuthorization(
    dealId: string,
    recId: string,
    auth: Authorization,
    order: Order | null,
    extraProblems: string[] = [],
  ): Promise<void> {
    if (auth.status === "DENIED") {
      await this.d.exec.withDeal(dealId, async (l) => {
        await l.tx.paymentRecord.update({
          where: { id: recId },
          data: { status: "FAILED", paypalId: auth.id, paypalStatus: auth.status },
        });
        if (l.deal.state === "FUNDING")
          await l.apply(
            { type: "funding.failed", reason: "AUTH_DECLINED" },
            { actor: "PAYPAL", payload: { paypalReason: auth.status_details?.reason ?? "DENIED" } },
          );
      });
      return;
    }
    if (auth.status === "PENDING") {
      await this.d.exec.withDeal(dealId, async (l) => {
        const rec = await l.tx.paymentRecord.findUniqueOrThrow({ where: { id: recId } });
        if (rec.paypalStatus === "PENDING") return;
        await l.tx.paymentRecord.update({
          where: { id: recId },
          data: { paypalId: auth.id, paypalStatus: "PENDING" },
        });
        await l.append("settlement.confirming", {
          actor: "PAYPAL",
          payload: {
            step: "authorize",
            message: COPY.confirmingWithPayPal,
            reason: auth.status_details?.reason,
          },
        });
      });
      return;
    }

    let needVoid: string | null = null;
    await this.d.exec.withDeal(dealId, async (l) => {
      const rec = await l.tx.paymentRecord.findUniqueOrThrow({ where: { id: recId } });
      if (rec.status === "SUCCEEDED" && l.deal.paypalAuthId === auth.id) return; // already done
      const problems = [...extraProblems, ...checkAuthorization(auth, l.deal)];
      await l.tx.paymentRecord.update({
        where: { id: recId },
        data: {
          status: "SUCCEEDED",
          paypalId: auth.id,
          paypalStatus: auth.status,
          raw: mergeRaw(rec, {
            authorizationId: auth.id,
            expirationTime: auth.expiration_time,
            createTime: auth.create_time,
          }),
        },
      });
      if (l.deal.state !== "FUNDING") {
        // Cancelled (timeout or buyer) while PayPal was authorizing: release it.
        if (!l.deal.paypalAuthId)
          await l.update(
            { paypalAuthId: auth.id },
            { actor: "SYSTEM" },
            "paypal.authorization.stored",
          );
        needVoid = "FUNDING_CLOSED";
        return;
      }
      if (problems.length) {
        await l.apply(
          { type: "funding.failed", reason: "ORDER_MISMATCH" },
          { actor: "SYSTEM", payload: { problems, alert: true } },
          { paypalAuthId: auth.id },
        );
        needVoid = "ORDER_MISMATCH";
        return;
      }
      // Decision D: FUNDING deals do not count, so re-check the cap now, under the buyer's policy lock.
      const policy = await lockSpendPolicy(l.tx, l.deal.buyerId);
      const o = evaluateAuthorize({
        freeze: false, // the authorization already exists; freeze was checked before authorizing
        amount: toMoney(l.deal.amount.toString()),
        policy,
        committedToday: await committedToday(l.tx, l.deal.buyerId, this.now(), dealId),
      });
      await recordPolicyDecision(l.tx, dealId, o);
      if (o.result !== "ALLOW") {
        await l.apply(
          { type: "funding.failed", reason: "POLICY_CAP" },
          { actor: "SYSTEM", payload: { reasons: o.reasons, alert: true } },
          { paypalAuthId: auth.id },
        );
        needVoid = "POLICY_CAP";
        return;
      }
      const createdAt = auth.create_time ? new Date(auth.create_time) : this.now();
      const expiresAt = auth.expiration_time ? new Date(auth.expiration_time) : null;
      await l.apply(
        { type: "paypal.authorization.created", verified: true },
        {
          actor: "PAYPAL",
          payload: {
            authorizationId: auth.id,
            expiresAt: expiresAt?.toISOString() ?? null,
            payerAccountStatus: order?.payment_source?.paypal?.account_status ?? null,
            message: COPY.fundsReserved,
          },
        },
        { paypalAuthId: auth.id, authExpiresAt: expiresAt, fundedAt: this.now() },
      );
      // ADR-001: deadlines are capped to the honor-period window after authorization.
      const cap = new Date(createdAt.getTime() + this.d.authSafeWindowHours * 3600_000);
      const contract = await l.tx.contract.findUnique({ where: { dealId } });
      if (contract && (!contract.deadline || contract.deadline > cap)) {
        await l.tx.contract.update({ where: { dealId }, data: { deadline: cap } });
      }
    });
    if (needVoid) await this.d.voider.voidAuthorization(dealId, needVoid);
  }

  /** GET-only: finish a PENDING authorization, or pick up one created by a crashed request. */
  async refreshPendingAuthorization(dealId: string): Promise<void> {
    const deal = await this.d.db.deal.findUnique({ where: { id: dealId } });
    if (!deal || deal.state !== "FUNDING") return;
    const rec = await latestRecord(this.d.db, dealId, "AUTHORIZE");
    if (!rec || rec.status !== "PENDING") return;
    if (rec.paypalId) {
      const auth = await this.d.paypal.getAuthorization(rec.paypalId);
      if (auth.status !== "PENDING") await this.finishAuthorization(dealId, rec.id, auth, null);
      return;
    }
    if (!deal.paypalOrderId) return;
    const order = await this.d.paypal.getOrder(deal.paypalOrderId);
    const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (auth) await this.finishAuthorization(dealId, rec.id, auth, order);
  }

  /** Sweeper: resume a PENDING ORDER record with the same key. */
  async resumeOrder(dealId: string, actorId: string): Promise<void> {
    await this.fund(dealId, actorId).catch((err) =>
      this.d.log.warn({ deal_id: dealId, err: (err as Error).message }, "order resume failed"),
    );
  }

  private async declined(dealId: string, recId: string, err: unknown) {
    await this.d.exec.withDeal(dealId, async (l) => {
      await l.tx.paymentRecord.update({
        where: { id: recId },
        data: { status: "FAILED", error: json(errorSummary(err)) },
      });
      if (l.deal.state === "FUNDING")
        await l.apply(
          { type: "funding.failed", reason: "AUTH_DECLINED" },
          { actor: "PAYPAL", payload: paypalReason(err) },
        );
    });
  }

  private async recordWriteError(recId: string, err: unknown) {
    const unknown = isOutcomeUnknown(err);
    await this.d.db.paymentRecord.update({
      where: { id: recId },
      data: unknown
        ? { error: json({ ...errorSummary(err), outcomeUnknown: true }) }
        : { status: "FAILED", error: json(errorSummary(err)) },
    });
    this.d.log.warn({ payment_record_id: recId, ...errorSummary(err) }, "paypal write failed");
  }

  private now() {
    return this.d.exec.clock();
  }
}

/** Order checks before authorizing (BUILD_PLAN 2.4). Returns problems; empty means OK. */
export function checkOrder(order: Order, deal: Deal, statuses: string[]): string[] {
  const out: string[] = [];
  const pu = order.purchase_units?.[0];
  if (!statuses.includes(order.status))
    out.push(`order status ${order.status}, expected ${statuses.join(" or ")}`);
  if (pu?.custom_id !== deal.id) out.push("custom_id does not match the deal");
  if (pu?.amount?.currency_code !== "USD") out.push("currency is not USD");
  const value = pu?.amount?.value;
  if (!value || !safeEquals(value, toMoney(deal.amount.toString())))
    out.push("amount does not match the deal");
  return out;
}

/** Authorization checks before LOCKED. */
export function checkAuthorization(auth: Authorization, deal: Deal): string[] {
  const out: string[] = [];
  if (auth.status !== "CREATED") out.push(`authorization status ${auth.status}`);
  if (auth.amount?.currency_code !== "USD") out.push("authorization currency is not USD");
  const v = auth.amount?.value;
  if (!v || !safeEquals(v, toMoney(deal.amount.toString())))
    out.push("authorization amount does not match");
  if (auth.custom_id !== undefined && auth.custom_id !== deal.id)
    out.push("authorization custom_id does not match");
  return out;
}

function safeEquals(a: string, b: string): boolean {
  try {
    return moneyEquals(a, b);
  } catch {
    return false;
  }
}

export function invalidState(deal: Deal, action: string): ProblemError {
  return new ProblemError(409, "invalid-state", `Cannot ${action} in ${deal.state}`, undefined, {
    state: deal.state,
  });
}

function paypalReason(err: unknown) {
  return err instanceof PayPalError
    ? { paypalIssue: err.issue, debugId: err.debugId }
    : { paypalIssue: (err as Error)?.name ?? "ERROR" };
}

export function paypalProblem(err: unknown, title: string): ProblemError {
  if (err instanceof ProblemError) return err;
  if (err instanceof PayPalError) {
    const status = isOutcomeUnknown(err) ? 502 : 422;
    return new ProblemError(status, "paypal-error", title, err.issue, {
      paypal_issue: err.issue,
      debug_id: err.debugId,
    });
  }
  if ((err as Error)?.name === "FrozenError")
    return new ProblemError(503, "frozen", "Payments are paused", "PAYLOCK_FREEZE is on");
  return new ProblemError(502, "paypal-error", title);
}
