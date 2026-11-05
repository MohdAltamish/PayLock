import type { Money } from "@paylock/schemas";

/**
 * Proof that a money-moving call was approved (invariant 1, decision A).
 *
 * The adapter's captureAuthorization, createPayout and refundCapture refuse to
 * call PayPal without one, and call `assertApproves` immediately before
 * sending. In the app, the implementation re-reads the persisted
 * PolicyDecision row (Task 11). CLI smoke scripts use SmokeApproval, which
 * lives in scripts/ and is never imported by app code (enforced by test).
 */
export type ApprovedAction = "capture" | "payout" | "refund";

export interface ApprovalRequest {
  dealId: string;
  action: ApprovedAction;
  amount: Money;
}

export interface SettlementApproval {
  /** Identifies the approval in logs (PolicyDecision id, or "smoke"). */
  readonly id: string;
  /** Throws if this exact action is not approved. */
  assertApproves(req: ApprovalRequest): Promise<void>;
}

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalError";
  }
}

export class FrozenError extends Error {
  constructor(action: string) {
    super(`PAYLOCK_FREEZE is on: ${action} is blocked (only void is allowed)`);
    this.name = "FrozenError";
  }
}
