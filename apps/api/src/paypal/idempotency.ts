import { createHash } from "node:crypto";

/**
 * PayPal-Request-Id for a money action (invariant 2, DESIGN.md section 8).
 *
 * `attempt` is the stored logical attempt on the PaymentRecord, not the HTTP
 * retry count: every HTTP retry of one logical attempt reuses the same key, so
 * PayPal deduplicates it. A new logical attempt (e.g. a payout re-send after a
 * terminal failure) increments `attempt` and gets a new key.
 */
export type PayPalAction =
  "order" | "authorize" | "capture" | "void" | "payout" | "refund" | `smoke-${string}`;

export function idempotencyKey(dealId: string, action: PayPalAction, attempt: number): string {
  if (!dealId || dealId.includes(":"))
    throw new Error("dealId must be non-empty and contain no ':'");
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("attempt must be an integer >= 1");
  return createHash("sha256").update(`${dealId}:${action}:${attempt}`).digest("hex");
}
