/* eslint-disable @typescript-eslint/no-explicit-any -- PayPal webhook resources differ per event type; fields are read defensively and validated before use. */
import { COPY } from "@paylock/schemas";
import type { PrismaClient } from "@prisma/client";
import type { DealExecutor } from "../deals/executor.js";
import { latestRecord } from "../deals/payments.js";
import type { PayPalLogger } from "../paypal/http.js";
import type { PayPalPort } from "../paypal/port.js";
import type { WebhookStore } from "./store.js";

export interface WebhookEventEnvelope {
  id: string;
  event_type: string;
  resource_type?: string;
  // PayPal resources vary by event type; fields are read defensively.
  resource?: { id?: string; custom_id?: string; status?: string; [k: string]: unknown };
  create_time?: string;
}

export interface ReconcileDeps {
  db: PrismaClient;
  exec: DealExecutor;
  paypal: Pick<PayPalPort, "getPayoutBatch">;
  /** GET-based, forward-only reconciliation of one deal. */
  reconcile: (dealId: string) => Promise<void>;
}

const DEAL_ID = /^c[a-z0-9]{20,32}$/;

/**
 * Processes a stored, verified event after the 200 has been sent
 * (ARCHITECTURE 4.3, DESIGN section 10). Webhooks only append: map the event
 * to a deal, append one "PayPal confirmed" DealEvent, and wake the
 * reconciler, which reads PayPal with GET and applies forward-only
 * transitions. A webhook never moves state directly and never triggers a
 * money write. The one local repair: a PAYOUTS-ITEM event fills in a missing
 * payout batch id, matched on sender_item_id = dealId and checked by GET.
 */
export class WebhookProcessor {
  constructor(
    private readonly store: WebhookStore,
    private readonly log: Pick<PayPalLogger, "info" | "error">,
    private readonly deps?: ReconcileDeps,
  ) {}

  async process(event: WebhookEventEnvelope): Promise<void> {
    try {
      await this.store.recordAttempt(event.id);
      let dealId: string | undefined;
      if (this.deps) {
        dealId = await this.mapToDeal(event);
        if (dealId) {
          await this.appendConfirmation(dealId, event);
          if (event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM."))
            await this.recoverPayoutBatch(dealId, event);
          await this.deps.reconcile(dealId);
        }
      }
      this.log.info(
        {
          event_id: event.id,
          event_type: event.event_type,
          resource_id: event.resource?.id,
          deal_id: dealId,
        },
        "paypal webhook processed",
      );
      await this.store.markProcessed(event.id, dealId);
    } catch (err) {
      // Left unprocessed; the sweeper retries it.
      this.log.error(
        { event_id: event.id, err: (err as Error).message },
        "paypal webhook processing failed",
      );
    }
  }

  /** Find the deal by custom_id, sender ids, or a stored PayPal resource id. */
  async mapToDeal(event: WebhookEventEnvelope): Promise<string | undefined> {
    const db = this.deps!.db;
    const r = (event.resource ?? {}) as Record<string, any>;
    const candidates: unknown[] = [
      r.custom_id,
      r.purchase_units?.[0]?.custom_id,
      r.payout_item?.sender_item_id,
      /^paylock-(.+)-\d+$/.exec(r.batch_header?.sender_batch_header?.sender_batch_id ?? "")?.[1],
    ];
    for (const c of candidates) {
      if (typeof c === "string" && DEAL_ID.test(c)) {
        const deal = await db.deal.findUnique({ where: { id: c }, select: { id: true } });
        if (deal) return deal.id;
      }
    }
    const ids = [
      r.id,
      r.payout_batch_id,
      r.batch_header?.payout_batch_id,
      ...(Array.isArray(r.disputed_transactions)
        ? r.disputed_transactions.map((t: any) => t?.seller_transaction_id)
        : []),
      ...(Array.isArray(r.links)
        ? r.links
            .filter((l: any) => l?.rel === "up")
            .map((l: any) => String(l.href).split("/").pop())
        : []),
    ].filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64);
    for (const id of ids) {
      const deal = await db.deal.findFirst({
        where: { OR: [{ paypalOrderId: id }, { paypalAuthId: id }] },
        select: { id: true },
      });
      if (deal) return deal.id;
      const rec = await db.paymentRecord.findUnique({
        where: { paypalId: id },
        select: { dealId: true },
      });
      if (rec) return rec.dealId;
    }
    return undefined;
  }

  private async appendConfirmation(dealId: string, event: WebhookEventEnvelope) {
    const r = (event.resource ?? {}) as Record<string, any>;
    const resourceId = String(r.id ?? r.payout_item_id ?? r.batch_header?.payout_batch_id ?? "");
    const status = String(r.status ?? r.transaction_status ?? r.batch_header?.batch_status ?? "");
    await this.deps!.exec.withDeal(dealId, async (l) => {
      // PayPal repeats events with new ids (pitfalls.md); one timeline entry per resource and status.
      const seen = await l.tx.dealEvent.count({
        where: {
          dealId,
          type: "paypal.confirmed",
          AND: [
            { payload: { path: ["eventType"], equals: event.event_type } },
            { payload: { path: ["resourceId"], equals: resourceId } },
            { payload: { path: ["status"], equals: status } },
          ],
        },
      });
      if (seen) return;
      await l.append("paypal.confirmed", {
        actor: "PAYPAL",
        payload: {
          eventType: event.event_type,
          eventId: event.id,
          resourceId,
          status,
          message: COPY.paypalConfirmed,
        },
      });
    });
  }

  /** Decision F / C8: recover the batch id for a payout whose POST response was lost. */
  private async recoverPayoutBatch(dealId: string, event: WebhookEventEnvelope) {
    const r = (event.resource ?? {}) as Record<string, any>;
    if (r.payout_item?.sender_item_id !== dealId || typeof r.payout_batch_id !== "string") return;
    const rec = await latestRecord(this.deps!.db, dealId, "PAYOUT");
    if (!rec || rec.status !== "PENDING" || rec.paypalId) return;
    const batch = await this.deps!.paypal.getPayoutBatch(r.payout_batch_id);
    const senderBatchId = batch.batch_header.sender_batch_header?.sender_batch_id;
    if (senderBatchId !== `paylock-${dealId}-${rec.attempt}`) return; // a different attempt
    await this.deps!.exec.withDeal(dealId, async (l) => {
      await l.tx.paymentRecord.update({
        where: { id: rec.id },
        data: { paypalId: batch.batch_header.payout_batch_id },
      });
      await l.append("paypal.payout.recovered", {
        actor: "PAYPAL",
        payload: { batchId: batch.batch_header.payout_batch_id, senderBatchId },
      });
    });
  }
}
