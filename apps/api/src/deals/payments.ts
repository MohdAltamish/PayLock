import type { PaymentKind, PaymentRecord, Prisma } from "@prisma/client";
import type { Tx } from "./executor.js";
import { normalize } from "../lib/canonical.js";
import { idempotencyKey, type PayPalAction } from "../paypal/idempotency.js";

const ACTION: Record<PaymentKind, PayPalAction> = {
  ORDER: "order",
  AUTHORIZE: "authorize",
  CAPTURE: "capture",
  VOID: "void",
  PAYOUT: "payout",
  REFUND: "refund",
};

export async function latestRecord(
  tx: Tx,
  dealId: string,
  kind: PaymentKind,
): Promise<PaymentRecord | null> {
  return tx.paymentRecord.findFirst({
    where: { dealId, kind },
    orderBy: [{ attempt: "desc" }, { createdAt: "desc" }],
  });
}

/**
 * A new logical attempt: next attempt number, key sha256(dealId:action:attempt),
 * amount fixed with the key (one key maps to one body, C7).
 */
export async function createPending(
  tx: Tx,
  i: {
    dealId: string;
    kind: PaymentKind;
    amount: string | null;
    policyDecisionId: string | null;
    raw?: Record<string, unknown>;
  },
): Promise<PaymentRecord> {
  const prev = await latestRecord(tx, i.dealId, i.kind);
  const attempt = (prev?.attempt ?? 0) + 1;
  return tx.paymentRecord.create({
    data: {
      dealId: i.dealId,
      kind: i.kind,
      attempt,
      idempotencyKey: idempotencyKey(i.dealId, ACTION[i.kind], attempt),
      policyDecisionId: i.policyDecisionId,
      amount: i.amount,
      status: "PENDING",
      raw: i.raw ? (normalize(i.raw) as Prisma.InputJsonValue) : undefined,
    },
  });
}

export function json(v: unknown): Prisma.InputJsonValue {
  return normalize(v) as Prisma.InputJsonValue;
}

/** Merge into a record's raw JSON (keeps earlier fields such as the void reason). */
export function mergeRaw(
  rec: PaymentRecord,
  extra: Record<string, unknown>,
): Prisma.InputJsonValue {
  const base = rec.raw && typeof rec.raw === "object" && !Array.isArray(rec.raw) ? rec.raw : {};
  return json({ ...(base as object), ...extra });
}

export function rawField<T = unknown>(
  rec: PaymentRecord | null | undefined,
  key: string,
): T | undefined {
  const raw = rec?.raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return (raw as Record<string, T>)[key];
  return undefined;
}
