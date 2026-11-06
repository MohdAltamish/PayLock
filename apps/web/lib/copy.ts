import { COPY } from "@paylock/schemas";

/**
 * UI copy (invariant 11): describe signals and money states, never people.
 * A test fails if the forbidden word appears anywhere in apps/web.
 */
export { COPY };

export const MONEY_LABEL: Record<string, string> = {
  none: "Not reserved",
  reserving: "Reserving funds",
  reserved: COPY.fundsReserved,
  releasing: "Releasing funds",
  released: COPY.fundsReleased,
  returned: COPY.fundsReturned,
  attention: COPY.settlementNeedsAttention,
};

export const STATE_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  CONTRACTED: "Contract ready",
  GUARDED: "Cleared to fund",
  FLAGGED: "High risk",
  AWAITING_APPROVAL: "Awaiting your approval",
  FUNDING: "Waiting for PayPal",
  LOCKED: "Funds reserved",
  DELIVERED: "Delivered",
  VERIFYING: "Verifying",
  NEEDS_REVIEW: "Needs your review",
  RELEASING: "Releasing",
  RELEASED: "Released",
  RELEASED_PARTIAL: "Partly released",
  SETTLEMENT_ERROR: "Settlement needs attention",
  VOIDED: "Funds returned",
  CANCELLED: "Cancelled",
};

export const REASON_LABEL: Record<string, string> = {
  POLICY_CAP: "Over your spend limit",
  ORDER_MISMATCH: "PayPal order did not match the deal",
  AUTH_DECLINED: "PayPal declined the payment method. Funds were not reserved.",
  AUTH_EXPIRED: COPY.reservationExpired,
  DEADLINE_PASSED: "Deadline passed without delivery",
  FUNDING_TIMEOUT: "Funding was not completed in time",
  VERIFICATION_FAILED: "The work did not meet the contract",
  HUMAN_REJECTED: "You rejected the delivery",
  BUYER_CANCELLED: "Cancelled by the buyer",
  REFUNDED: COPY.fundsReturnedRefunded,
};

/** Timeline titles for DealEvent types. */
export function eventTitle(type: string, payload: Record<string, unknown>): string {
  const msg = typeof payload.message === "string" ? payload.message : undefined;
  switch (type) {
    case "contract.created":
      return "Paylock AI drafted the contract";
    case "message.added":
      return `New message from the ${String(payload.from ?? "party")}`;
    case "risk.assessed":
      return `Risk check: ${String(payload.level ?? "").toLowerCase()} risk (score ${String(payload.score ?? "-")})`;
    case "buyer.approve":
      return "You approved funding";
    case "buyer.override":
      return "You overrode the risk check";
    case "buyer.cancel":
    case "buyer.reject":
      return "Deal cancelled";
    case "paypal.order.created":
      return "PayPal order created";
    case "paypal.order.ready":
      return "Waiting for your PayPal approval";
    case "paypal.authorization.created":
      return COPY.fundsReserved;
    case "funding.failed":
      return REASON_LABEL[String(payload.reason)] ?? "Funding failed";
    case "seller.deliverable.submitted":
      return "Seller submitted the work";
    case "verifier.started":
      return "Paylock AI is reviewing the work…";
    case "verifier.decided":
      return `Verification: ${String(payload.outcome)} (${String(payload.score)}%)`;
    case "verifier.invalid":
      return "Verification needs a person";
    case "human.approve":
      return "You approved the release";
    case "human.reject":
      return "You rejected the delivery";
    case "settlement.capture.requested":
      return `Capturing $${String(payload.amount)} from the reservation`;
    case "paypal.capture.completed":
      return "PayPal captured the payment";
    case "settlement.payout.requested":
      return `Paying the seller $${String(payload.amount)}`;
    case "paypal.payout.sent":
    case "paypal.payout.recovered":
      return "Payout sent to PayPal";
    case "settlement.confirming":
      return COPY.confirmingWithPayPal;
    case "settlement.released":
      return COPY.fundsReleased;
    case "settlement.void.requested":
      return "Returning the reserved funds";
    case "settlement.voided":
    case "paypal.authorization.voided":
      return msg ?? COPY.fundsReturned;
    case "authorization.expired":
      return COPY.reservationExpired;
    case "settlement.failed":
      return "PayPal could not complete this step";
    case "human.retry":
      return "You retried the settlement";
    case "settlement.refund.requested":
      return "Refunding the buyer";
    case "paypal.confirmed":
      return `${COPY.paypalConfirmed}: ${String(payload.eventType ?? "")}`;
    default:
      return msg ?? type;
  }
}

export const ACTOR_LABEL: Record<string, string> = {
  HUMAN: "Person",
  AGENT: "Paylock AI",
  PAYPAL: "PayPal",
  SYSTEM: "Paylock",
};
