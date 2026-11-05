import { COPY, moneyEquals, toMoney } from "@paylock/schemas";
import type { Deal, PaymentRecord, PrismaClient } from "@prisma/client";
import { DealNotFoundError, type DealExecutor, type LockedDeal } from "../deals/executor.js";
import { createPending, json, latestRecord, mergeRaw, rawField } from "../deals/payments.js";
import type { DealState } from "@paylock/schemas";
import { ProblemError } from "../lib/problem.js";
import { isDuplicatePayoutBatch } from "../paypal/adapter.js";
import { PayPalError } from "../paypal/errors.js";
import type { PayPalLogger } from "../paypal/http.js";
import { errorSummary, isOutcomeUnknown, type PayPalPort } from "../paypal/port.js";
import type { Capture, PayoutBatch } from "../paypal/types.js";
import { PolicyDecisionApproval, recordPolicyDecision } from "../policy/decisions.js";
import { evaluateCapture, evaluatePayout, evaluateRefund, evaluateVoid } from "../policy/engine.js";
import { captureAmount, releasePercent } from "./math.js";

/**
 * Settlement (ADR-011, invariant 1). Deterministic; no LLM.
 *
 * Every money step is two transactions around one adapter call:
 *   1. lock the deal, evaluate policy, write PolicyDecision + PENDING
 *      PaymentRecord (+ timeline event and audit) together;
 *   2. call PayPal with a SettlementApproval that re-reads that PolicyDecision;
 *   3. record the result and transition.
 * A PENDING record whose outcome is unknown is resumed with the same key.
 *
 * Release order: capture (final_capture=true) -> GET capture until COMPLETED
 * or DECLINED (C7: amount and status re-checked) -> payout -> poll batch.
 * `drive` may write to PayPal (requests, sweeper). `refresh` only reads
 * (webhook reconciler): webhooks never trigger money writes.
 */

/** Item statuses after which a payout may be re-sent with a new sender_batch_id (decision F). */
export const PAYOUT_RESEND_STATUSES = ["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED"];
/** Poll again, never re-send. */
export const PAYOUT_WAIT_STATUSES = ["PENDING", "UNCLAIMED", "ONHOLD"];

const VOIDABLE: DealState[] = [
  "LOCKED",
  "DELIVERED",
  "VERIFYING",
  "NEEDS_REVIEW",
  "SETTLEMENT_ERROR",
];
type VoidReason = "VERIFICATION_FAILED" | "HUMAN_REJECTED" | "DEADLINE_PASSED";
const DEAL_VOID_REASONS: string[] = ["VERIFICATION_FAILED", "HUMAN_REJECTED", "DEADLINE_PASSED"];

export interface SettlementDeps {
  db: PrismaClient;
  exec: DealExecutor;
  paypal: PayPalPort;
  isFrozen: () => boolean;
  log: Pick<PayPalLogger, "info" | "warn" | "error">;
}

export class Settlement {
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly d: SettlementDeps) {}

  // ---------- entry points ----------

  /** Drive a RELEASING deal forward (may call PayPal). */
  release(dealId: string): Promise<void> {
    return this.serial(dealId, () => this.drive(dealId, true));
  }

  /** GET-only reconciliation for the webhook path; forward transitions only. */
  refresh(dealId: string): Promise<void> {
    return this.serial(dealId, async () => {
      const deal = await this.d.db.deal.findUnique({ where: { id: dealId } });
      if (!deal) return;
      if (deal.state === "RELEASING") await this.drive(dealId, false);
      const v = await latestRecord(this.d.db, dealId, "VOID");
      if (v?.status === "PENDING" && deal.paypalAuthId) {
        const a = await this.d.paypal.getAuthorization(deal.paypalAuthId);
        if (a.status === "VOIDED") await this.voidSucceeded(dealId, v.id);
      }
      const r = await latestRecord(this.d.db, dealId, "REFUND");
      if (r?.status === "PENDING" && r.paypalId) await this.refreshRefund(dealId, r);
    });
  }

  /** Void the deal's authorization (allowed during a freeze). Idempotent. */
  voidAuthorization(dealId: string, reason: string): Promise<void> {
    return this.serial(dealId, async () => {
      const rec = await this.d.exec.withDeal(dealId, async (l) => {
        if (!l.deal.paypalAuthId) return null;
        const prev = await latestRecord(l.tx, dealId, "VOID");
        if (prev?.status === "SUCCEEDED") return null;
        if (prev?.status === "PENDING") return prev;
        const o = evaluateVoid({ freeze: this.d.isFrozen(), reason });
        const pd = await recordPolicyDecision(l.tx, dealId, o);
        const r = await createPending(l.tx, {
          dealId,
          kind: "VOID",
          amount: null,
          policyDecisionId: pd.id,
          raw: { reason },
        });
        await l.append("settlement.void.requested", {
          actor: "SYSTEM",
          payload: { reason, attempt: r.attempt, policyDecisionId: pd.id },
        });
        return r;
      });
      if (rec) await this.sendVoid(dealId, rec);
    });
  }

  /** Buyer retry from SETTLEMENT_ERROR: resumes only the failed step. */
  async retry(dealId: string, actorId: string): Promise<{ step: string }> {
    const step = await this.d.exec.withDeal(dealId, async (l) => {
      if (l.deal.state !== "SETTLEMENT_ERROR")
        throw new ProblemError(409, "invalid-state", `Nothing to retry in ${l.deal.state}`);
      const failed = await l.tx.paymentRecord.findFirst({
        where: {
          dealId,
          kind: { in: ["CAPTURE", "PAYOUT", "VOID", "REFUND"] },
          status: { not: "SUCCEEDED" },
        },
        orderBy: { createdAt: "desc" },
      });
      const capture = await latestRecord(l.tx, dealId, "CAPTURE");
      const kind = failed?.kind ?? (capture?.status === "SUCCEEDED" ? "PAYOUT" : "CAPTURE");
      const meta = { actor: "HUMAN" as const, actorId };
      if (kind === "VOID") {
        await l.apply({ type: "human.retry", step: "void" }, meta);
        return {
          step: "void",
          reason: rawField<string>(failed, "reason") ?? "VERIFICATION_FAILED",
        };
      }
      if (kind === "REFUND")
        throw new ProblemError(
          409,
          "use-refund",
          "Retry the refund instead",
          "POST /settlement/refund",
        );
      if (kind === "PAYOUT" && failed) {
        if (failed.status === "PENDING")
          throw new ProblemError(
            409,
            "payout-pending",
            "Payout is still pending with PayPal",
            "Poll again; never re-send",
          );
        const status = failed.paypalStatus ?? "";
        const neverSent = !failed.paypalId && !rawField(failed, "duplicateBatch");
        if (!neverSent && !PAYOUT_RESEND_STATUSES.includes(status) && status !== "BATCH_DENIED")
          throw new ProblemError(
            409,
            "payout-not-resendable",
            `Payout ended ${status}; it cannot be re-sent`,
          );
      }
      const s = kind === "PAYOUT" ? "payout" : "capture";
      await l.apply({ type: "human.retry", step: s }, meta);
      return { step: s, reason: "" };
    });
    if (step.step === "void") await this.voidAuthorization(dealId, step.reason);
    else await this.release(dealId);
    return { step: step.step };
  }

  /** P2: refund the completed capture after a payout cannot succeed (SECURITY_PRIVACY section 4). */
  refund(dealId: string, actorId: string): Promise<void> {
    return this.serial(dealId, async () => {
      const rec = await this.d.exec.withDeal(dealId, async (l) => {
        if (l.deal.state !== "SETTLEMENT_ERROR")
          throw new ProblemError(409, "invalid-state", `Cannot refund in ${l.deal.state}`);
        const prev = await latestRecord(l.tx, dealId, "REFUND");
        if (prev?.status === "SUCCEEDED") return null;
        if (prev?.status === "PENDING") return prev;
        const cap = await latestRecord(l.tx, dealId, "CAPTURE");
        const pay = await latestRecord(l.tx, dealId, "PAYOUT");
        const captured =
          cap?.status === "SUCCEEDED" && cap.amount ? toMoney(cap.amount.toString()) : null;
        const o = evaluateRefund({
          freeze: this.d.isFrozen(),
          amount: captured ?? "0.00",
          capture: captured ? { status: cap!.paypalStatus ?? "", amount: captured } : null,
          payoutTerminallyFailed: !pay || pay.status === "FAILED",
        });
        const pd = await recordPolicyDecision(l.tx, dealId, o);
        if (o.result !== "ALLOW")
          throw new ProblemError(
            409,
            "refund-blocked",
            "Refund is not allowed",
            o.reasons.join(", "),
          );
        const r = await createPending(l.tx, {
          dealId,
          kind: "REFUND",
          amount: captured,
          policyDecisionId: pd.id,
          raw: { captureId: cap!.paypalId },
        });
        await l.append("settlement.refund.requested", {
          actor: "HUMAN",
          actorId,
          payload: { amount: captured, policyDecisionId: pd.id },
        });
        return r;
      });
      if (rec) await this.sendRefund(dealId, rec);
    });
  }

  // ---------- release driver ----------

  private async drive(dealId: string, allowWrites: boolean): Promise<void> {
    for (let i = 0; i < 6; i++) {
      const deal = await this.d.db.deal.findUnique({ where: { id: dealId } });
      if (!deal || deal.state !== "RELEASING") return;
      const cap = await latestRecord(this.d.db, dealId, "CAPTURE");
      if (!cap || cap.status === "FAILED") {
        if (!allowWrites) return;
        const rec = await this.startCapture(dealId);
        if (!rec) return;
        await this.sendCapture(deal, rec);
        if (await this.stillUnknown(rec.id)) return; // the sweeper resumes it with the same key
        continue;
      }
      if (cap.status === "PENDING") {
        if (cap.paypalId) {
          // Poll GET /v2/payments/captures/{id} until COMPLETED or DECLINED.
          const changed = await this.confirmCapture(dealId, cap.id, cap.paypalId);
          if (!changed) return;
          continue;
        }
        if (!allowWrites) return;
        await this.sendCapture(deal, cap); // resume with the same key
        if (await this.stillUnknown(cap.id)) return;
        continue;
      }
      // Capture SUCCEEDED (GET-confirmed COMPLETED): payout step.
      const pay = await latestRecord(this.d.db, dealId, "PAYOUT");
      if (!pay || pay.status === "FAILED") {
        if (!allowWrites) return;
        const rec = await this.startPayout(dealId, cap);
        if (!rec) return;
        await this.sendPayout(deal, rec);
        if (await this.stillUnknown(rec.id)) return;
        continue;
      }
      if (pay.status === "PENDING") {
        if (pay.paypalId) {
          const batch = await this.d.paypal.getPayoutBatch(pay.paypalId);
          const changed = await this.applyPayoutBatch(dealId, pay.id, batch);
          if (!changed) return;
          continue;
        }
        if (!allowWrites || rawField(pay, "duplicateBatch")) return; // wait for the PAYOUTS-ITEM webhook
        await this.sendPayout(deal, pay);
        if (await this.stillUnknown(pay.id)) return;
        continue;
      }
      return; // payout SUCCEEDED: applyPayoutBatch already released the deal
    }
  }

  /** PENDING with no PayPal id: the outcome of the last write is unknown (or it was a duplicate batch). */
  private async stillUnknown(recId: string): Promise<boolean> {
    const r = await this.d.db.paymentRecord.findUniqueOrThrow({ where: { id: recId } });
    return r.status === "PENDING" && !r.paypalId;
  }

  private async startCapture(dealId: string): Promise<PaymentRecord | null> {
    return this.d.exec.withDeal(dealId, async (l) => {
      if (l.deal.state !== "RELEASING") return null;
      const decision = await l.tx.decision.findFirst({
        where: { dealId },
        orderBy: { createdAt: "desc" },
      });
      const contract = await l.tx.contract.findUnique({ where: { dealId } });
      // A human approval is the human.approve event recorded after this decision.
      const humanApproved = decision
        ? (await l.tx.dealEvent.count({
            where: { dealId, type: "human.approve", createdAt: { gte: decision.createdAt } },
          })) > 0
        : false;
      const pct = decision
        ? humanApproved
          ? (releasePercent(decision.outcome, decision.score, contract?.partialPayMin ?? 70) ?? 100)
          : releasePercent(decision.outcome, decision.score, contract?.partialPayMin ?? 70)
        : null;
      const amount = pct === null ? "0.00" : captureAmount(toMoney(l.deal.amount.toString()), pct);
      const o = evaluateCapture({
        freeze: this.d.isFrozen(),
        amount,
        decision: decision ? { id: decision.id, outcome: decision.outcome } : null,
        humanApproved,
        requiresHumanRelease: l.deal.requiresHumanRelease,
        authExpiresAt: l.deal.authExpiresAt,
        now: this.d.exec.clock(),
      });
      const pd = await recordPolicyDecision(l.tx, dealId, o, decision?.id);
      if (o.result !== "ALLOW" || !l.deal.paypalAuthId) {
        await l.apply(
          { type: "settlement.failed", step: "capture" },
          {
            actor: "SYSTEM",
            payload: { reasons: o.reasons, policyDecisionId: pd.id, alert: true },
          },
        );
        return null;
      }
      const rec = await createPending(l.tx, {
        dealId,
        kind: "CAPTURE",
        amount,
        policyDecisionId: pd.id,
        raw: { percent: pct },
      });
      await l.append("settlement.capture.requested", {
        actor: "SYSTEM",
        payload: { amount, percent: pct, attempt: rec.attempt, policyDecisionId: pd.id },
      });
      return rec;
    });
  }

  private async sendCapture(deal: Deal, rec: PaymentRecord): Promise<void> {
    try {
      const cap = await this.d.paypal.captureAuthorization(
        new PolicyDecisionApproval(this.d.db, rec.policyDecisionId!),
        {
          dealId: deal.id,
          authorizationId: deal.paypalAuthId!,
          amount: toMoney(rec.amount!.toString()),
          finalCapture: true,
          requestId: rec.idempotencyKey,
        },
      );
      await this.confirmCapture(deal.id, rec.id, cap.id);
    } catch (err) {
      if (
        err instanceof PayPalError &&
        err.hasIssue("AUTHORIZATION_ALREADY_CAPTURED") &&
        deal.paypalOrderId
      ) {
        // An earlier attempt captured; find it on the order and confirm it with GET.
        const order = await this.d.paypal.getOrder(deal.paypalOrderId);
        const existing = order.purchase_units?.[0]?.payments?.captures?.[0];
        if (existing) {
          await this.confirmCapture(deal.id, rec.id, existing.id);
          return;
        }
      }
      await this.writeFailed(deal.id, rec, err, "capture");
    }
  }

  /**
   * C7 re-check: GET the capture and compare amount and status before recording.
   * Returns true if the record left PENDING.
   */
  private async confirmCapture(dealId: string, recId: string, captureId: string): Promise<boolean> {
    const got = await this.d.paypal.getCapture(captureId);
    return this.d.exec.withDeal(dealId, async (l) => {
      const rec = await l.tx.paymentRecord.findUniqueOrThrow({ where: { id: recId } });
      if (rec.status !== "PENDING") return false;
      const expected = toMoney(rec.amount!.toString());
      const amountOk =
        got.amount?.currency_code === "USD" &&
        !!got.amount.value &&
        safeEq(got.amount.value, expected);
      const base = { paypalId: got.id, paypalStatus: got.status };
      if (!amountOk) {
        await l.tx.paymentRecord.update({
          where: { id: recId },
          data: {
            ...base,
            status: "FAILED",
            error: json({
              name: "CAPTURE_AMOUNT_MISMATCH",
              got: got.amount?.value ?? null,
              expected,
            }),
          },
        });
        await this.failIfReleasing(l, "capture", {
          reason: "CAPTURE_AMOUNT_MISMATCH",
          captureId: got.id,
        });
        return true;
      }
      if (got.status === "COMPLETED") {
        await l.tx.paymentRecord.update({
          where: { id: recId },
          data: { ...base, status: "SUCCEEDED", raw: mergeRaw(rec, captureFacts(got)) },
        });
        await l.append("paypal.capture.completed", {
          actor: "PAYPAL",
          payload: {
            captureId: got.id,
            amount: expected,
            fee: captureFacts(got).paypalFee ?? null,
          },
        });
        return true;
      }
      if (got.status === "PENDING") {
        if (rec.paypalStatus !== "PENDING") {
          await l.tx.paymentRecord.update({ where: { id: recId }, data: base });
          await l.append("settlement.confirming", {
            actor: "PAYPAL",
            payload: {
              step: "capture",
              recordId: recId,
              message: COPY.confirmingWithPayPal,
              reason: got.status_details?.reason ?? null,
            },
          });
        }
        return false;
      }
      // DECLINED, FAILED, or an unexpected terminal status: never pay out.
      await l.tx.paymentRecord.update({
        where: { id: recId },
        data: { ...base, status: "FAILED", error: json({ name: `CAPTURE_${got.status}` }) },
      });
      await this.failIfReleasing(l, "capture", { paypalStatus: got.status, captureId: got.id });
      return true;
    });
  }

  private async startPayout(dealId: string, cap: PaymentRecord): Promise<PaymentRecord | null> {
    return this.d.exec.withDeal(dealId, async (l) => {
      if (l.deal.state !== "RELEASING") return null;
      const amount = toMoney(cap.amount!.toString());
      const o = evaluatePayout({
        freeze: this.d.isFrozen(),
        amount,
        capture: { status: cap.paypalStatus ?? "", amount },
      });
      if (!l.deal.payoutEmail) {
        o.result = "BLOCK";
        o.reasons.push("NO_PAYOUT_EMAIL");
      }
      const decision = await l.tx.decision.findFirst({
        where: { dealId },
        orderBy: { createdAt: "desc" },
      });
      const pd = await recordPolicyDecision(l.tx, dealId, o, decision?.id);
      if (o.result !== "ALLOW") {
        await l.apply(
          { type: "settlement.failed", step: "payout" },
          {
            actor: "SYSTEM",
            payload: { reasons: o.reasons, policyDecisionId: pd.id, alert: true },
          },
        );
        return null;
      }
      const rec = await createPending(l.tx, {
        dealId,
        kind: "PAYOUT",
        amount,
        policyDecisionId: pd.id,
      });
      await l.append("settlement.payout.requested", {
        actor: "SYSTEM",
        payload: {
          amount,
          attempt: rec.attempt,
          senderBatchId: `paylock-${dealId}-${rec.attempt}`,
        },
      });
      return rec;
    });
  }

  private async sendPayout(deal: Deal, rec: PaymentRecord): Promise<void> {
    try {
      const batch = await this.d.paypal.createPayout(
        new PolicyDecisionApproval(this.d.db, rec.policyDecisionId!),
        {
          dealId: deal.id,
          attempt: rec.attempt,
          receiverEmail: deal.payoutEmail!,
          amount: toMoney(rec.amount!.toString()),
          requestId: rec.idempotencyKey,
          note: "Paylock: funds released for verified work",
        },
      );
      await this.d.exec.withDeal(deal.id, async (l) => {
        await l.tx.paymentRecord.update({
          where: { id: rec.id },
          data: {
            paypalId: batch.batch_header.payout_batch_id,
            paypalStatus: batch.batch_header.batch_status,
          },
        });
        await l.append("paypal.payout.sent", {
          actor: "PAYPAL",
          payload: {
            batchId: batch.batch_header.payout_batch_id,
            status: batch.batch_header.batch_status,
          },
        });
      });
    } catch (err) {
      if (isDuplicatePayoutBatch(err)) {
        // Already sent (C8). Never re-POST; the batch id comes from the PAYOUTS-ITEM webhook.
        await this.d.exec.withDeal(deal.id, async (l) => {
          await l.tx.paymentRecord.update({
            where: { id: rec.id },
            data: { raw: mergeRaw(rec, { duplicateBatch: true }), error: json(errorSummary(err)) },
          });
          await l.append("settlement.confirming", {
            actor: "SYSTEM",
            payload: { step: "payout", recordId: rec.id, message: COPY.confirmingWithPayPal },
          });
        });
        return;
      }
      await this.writeFailed(deal.id, rec, err, "payout");
    }
  }

  /** Apply a GET payout batch result. Returns true if the record left PENDING. */
  async applyPayoutBatch(dealId: string, recId: string, batch: PayoutBatch): Promise<boolean> {
    const item = batch.items?.[0];
    const itemStatus = item?.transaction_status;
    const batchStatus = batch.batch_header.batch_status;
    return this.d.exec.withDeal(dealId, async (l) => {
      const rec = await l.tx.paymentRecord.findUniqueOrThrow({ where: { id: recId } });
      if (rec.status !== "PENDING") return false;
      if (itemStatus === "SUCCESS") {
        await l.tx.paymentRecord.update({
          where: { id: recId },
          data: {
            status: "SUCCEEDED",
            paypalStatus: "SUCCESS",
            raw: mergeRaw(rec, {
              payoutItemId: item?.payout_item_id,
              transactionId: item?.transaction_id,
            }),
          },
        });
        const cap = await latestRecord(l.tx, dealId, "CAPTURE");
        const pct = rawField<number>(cap, "percent") ?? 100;
        if (l.deal.state === "RELEASING")
          await l.apply(
            { type: "settlement.released", partial: pct < 100 },
            {
              actor: "PAYPAL",
              payload: {
                batchId: rec.paypalId,
                amount: toMoney(rec.amount!.toString()),
                message: COPY.fundsReleased,
              },
            },
          );
        return true;
      }
      if ((itemStatus && PAYOUT_RESEND_STATUSES.includes(itemStatus)) || batchStatus === "DENIED") {
        const status = itemStatus ?? "BATCH_DENIED";
        await l.tx.paymentRecord.update({
          where: { id: recId },
          data: {
            status: "FAILED",
            paypalStatus: batchStatus === "DENIED" && !itemStatus ? "BATCH_DENIED" : status,
            error: json({ name: item?.errors?.name ?? status }),
          },
        });
        await this.failIfReleasing(l, "payout", {
          itemStatus: status,
          errorName: item?.errors?.name ?? null,
        });
        return true;
      }
      const s = itemStatus ?? batchStatus;
      if (rec.paypalStatus !== s) {
        await l.tx.paymentRecord.update({ where: { id: recId }, data: { paypalStatus: s } });
        const shown = await l.tx.dealEvent.count({
          where: {
            dealId,
            type: "settlement.confirming",
            payload: { path: ["recordId"], equals: recId },
          },
        });
        if (!shown)
          await l.append("settlement.confirming", {
            actor: "PAYPAL",
            payload: {
              step: "payout",
              recordId: recId,
              status: s,
              message: COPY.confirmingWithPayPal,
            },
          });
      }
      return false;
    });
  }

  // ---------- void / refund internals ----------

  private async sendVoid(dealId: string, rec: PaymentRecord): Promise<void> {
    const deal = await this.d.db.deal.findUniqueOrThrow({ where: { id: dealId } });
    try {
      await this.d.paypal.voidAuthorization(deal.paypalAuthId!, rec.idempotencyKey);
      await this.voidSucceeded(dealId, rec.id);
    } catch (err) {
      if (!isOutcomeUnknown(err)) {
        // A definitive error may mean it is already voided: read it back.
        const a = await this.d.paypal.getAuthorization(deal.paypalAuthId!).catch(() => null);
        if (a?.status === "VOIDED") {
          await this.voidSucceeded(dealId, rec.id);
          return;
        }
      }
      await this.writeFailed(dealId, rec, err, "void");
    }
  }

  private async voidSucceeded(dealId: string, recId: string): Promise<void> {
    await this.d.exec.withDeal(dealId, async (l) => {
      const rec = await l.tx.paymentRecord.findUniqueOrThrow({ where: { id: recId } });
      if (rec.status === "SUCCEEDED") return;
      await l.tx.paymentRecord.update({
        where: { id: recId },
        data: { status: "SUCCEEDED", paypalStatus: "VOIDED", paypalId: rec.paypalId ?? null },
      });
      const reason = rawField<string>(rec, "reason") ?? "VERIFICATION_FAILED";
      if (VOIDABLE.includes(l.deal.state) && DEAL_VOID_REASONS.includes(reason)) {
        await l.apply(
          { type: "settlement.voided", reason: reason as VoidReason },
          { actor: "PAYPAL", payload: { message: COPY.fundsReturned } },
        );
      } else {
        await l.append("paypal.authorization.voided", {
          actor: "PAYPAL",
          payload: { reason, message: COPY.fundsReturned },
        });
      }
    });
  }

  private async sendRefund(dealId: string, rec: PaymentRecord): Promise<void> {
    try {
      const r = await this.d.paypal.refundCapture(
        new PolicyDecisionApproval(this.d.db, rec.policyDecisionId!),
        {
          dealId,
          captureId: rawField<string>(rec, "captureId")!,
          amount: toMoney(rec.amount!.toString()),
          requestId: rec.idempotencyKey,
        },
      );
      await this.d.exec.withDeal(dealId, async (l) => {
        if (r.status === "COMPLETED") {
          await l.tx.paymentRecord.update({
            where: { id: rec.id },
            data: { status: "SUCCEEDED", paypalId: r.id, paypalStatus: r.status },
          });
          await l.apply(
            { type: "settlement.voided", reason: "REFUNDED" },
            { actor: "PAYPAL", payload: { refundId: r.id, message: COPY.fundsReturnedRefunded } },
          );
        } else if (r.status === "PENDING") {
          await l.tx.paymentRecord.update({
            where: { id: rec.id },
            data: { paypalId: r.id, paypalStatus: r.status },
          });
          await l.append("settlement.confirming", {
            actor: "PAYPAL",
            payload: { step: "refund", recordId: rec.id, message: COPY.confirmingWithPayPal },
          });
        } else {
          await l.tx.paymentRecord.update({
            where: { id: rec.id },
            data: { status: "FAILED", paypalId: r.id, paypalStatus: r.status },
          });
          await l.apply(
            { type: "settlement.failed", step: "refund" },
            { actor: "PAYPAL", payload: { alert: true } },
          );
        }
      });
    } catch (err) {
      await this.writeFailed(dealId, rec, err, "refund");
    }
  }

  private async refreshRefund(dealId: string, rec: PaymentRecord): Promise<void> {
    const captureId = rawField<string>(rec, "captureId");
    if (!captureId) return;
    const cap = await this.d.paypal.getCapture(captureId);
    if (cap.status !== "REFUNDED") return;
    await this.d.exec.withDeal(dealId, async (l) => {
      const r = await l.tx.paymentRecord.findUniqueOrThrow({ where: { id: rec.id } });
      if (r.status !== "PENDING") return;
      await l.tx.paymentRecord.update({
        where: { id: rec.id },
        data: { status: "SUCCEEDED", paypalStatus: "COMPLETED" },
      });
      if (l.deal.state === "SETTLEMENT_ERROR")
        await l.apply(
          { type: "settlement.voided", reason: "REFUNDED" },
          { actor: "PAYPAL", payload: { message: COPY.fundsReturnedRefunded } },
        );
    });
  }

  // ---------- shared ----------

  /** Unknown outcome: keep PENDING for a same-key resume. Definitive: FAILED + SETTLEMENT_ERROR. */
  private async writeFailed(
    dealId: string,
    rec: PaymentRecord,
    err: unknown,
    step: "capture" | "payout" | "void" | "refund",
  ): Promise<void> {
    const summary = errorSummary(err);
    this.d.log.warn({ deal_id: dealId, step, ...summary }, "settlement step failed");
    if (isOutcomeUnknown(err)) {
      await this.d.db.paymentRecord.update({
        where: { id: rec.id },
        data: { error: json({ ...summary, outcomeUnknown: true }) },
      });
      return;
    }
    await this.d.exec.withDeal(dealId, async (l) => {
      await l.tx.paymentRecord.update({
        where: { id: rec.id },
        data: { status: "FAILED", error: json(summary) },
      });
      const payload = {
        alert: true,
        paypalIssue: summary.issue ?? summary.name,
        debugId: summary.debug_id ?? null,
      };
      if (step === "void") {
        if (VOIDABLE.includes(l.deal.state))
          await l.apply({ type: "settlement.failed", step: "void" }, { actor: "SYSTEM", payload });
        else await l.append("settlement.void.failed", { actor: "SYSTEM", payload });
      } else if (step === "refund") {
        if (l.deal.state === "SETTLEMENT_ERROR")
          await l.apply(
            { type: "settlement.failed", step: "refund" },
            { actor: "SYSTEM", payload },
          );
      } else {
        await this.failIfReleasing(l, step, payload);
      }
    });
  }

  private async failIfReleasing(
    l: LockedDeal,
    step: "capture" | "payout",
    payload: Record<string, unknown>,
  ) {
    if (l.deal.state === "RELEASING")
      await l.apply(
        { type: "settlement.failed", step },
        {
          actor: "SYSTEM",
          payload: { ...payload, alert: true, message: COPY.settlementNeedsAttention },
        },
      );
  }

  /** One settlement action per deal at a time in this process. */
  private serial<T>(dealId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(dealId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.chains.set(dealId, next);
    void next
      .catch((err) => {
        if (!(err instanceof ProblemError) && !(err instanceof DealNotFoundError))
          this.d.log.error({ deal_id: dealId, err: (err as Error).message }, "settlement error");
      })
      .finally(() => {
        if (this.chains.get(dealId) === next) this.chains.delete(dealId);
      });
    return next;
  }
}

function captureFacts(c: Capture) {
  const b = c.seller_receivable_breakdown;
  return {
    captureId: c.id,
    gross: b?.gross_amount?.value,
    paypalFee: b?.paypal_fee?.value,
    net: b?.net_amount?.value,
  };
}

function safeEq(a: string, b: string): boolean {
  try {
    return moneyEquals(a, b);
  } catch {
    return false;
  }
}
