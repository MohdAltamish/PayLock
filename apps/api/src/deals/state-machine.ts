import type { BlockReason, DealState, RiskLevel } from "@paylock/schemas";

/**
 * Deal state machine (DESIGN.md section 3). Pure: no I/O, no clock.
 * `transition` returns the next state or a typed error; the executor
 * (transition.ts) persists it with DealEvent + AuditLog under a row lock.
 */

export type DealEvent =
  | { type: "contract.created" }
  | { type: "risk.assessed"; level: RiskLevel; policy: "allow" | "require_approval" | "block"; policyCap?: boolean }
  | { type: "buyer.override"; reason: string }
  | { type: "buyer.approve" }
  | { type: "buyer.reject" }
  | { type: "buyer.cancel" }
  | { type: "paypal.order.created"; policyAllowed: boolean }
  | { type: "paypal.authorization.created"; verified: boolean }
  | { type: "funding.failed"; reason: Extract<BlockReason, "AUTH_DECLINED" | "ORDER_MISMATCH" | "POLICY_CAP" | "FUNDING_TIMEOUT"> }
  | { type: "seller.deliverable.submitted" }
  | { type: "verifier.started" }
  | {
      type: "verifier.decided";
      outcome: "PASS" | "PARTIAL" | "FAIL";
      score: number;
      partialPayMin: number;
      needsHumanReview: boolean;
    }
  | { type: "verifier.invalid" }
  | { type: "settlement.voided"; reason: Extract<BlockReason, "VERIFICATION_FAILED" | "HUMAN_REJECTED" | "DEADLINE_PASSED" | "AUTH_EXPIRED" | "REFUNDED"> }
  | { type: "authorization.expired" }
  | { type: "human.approve" }
  | { type: "human.reject" }
  | { type: "settlement.released"; partial: boolean }
  | { type: "settlement.failed"; step: "capture" | "payout" | "void" | "refund" }
  | { type: "human.retry"; step: "capture" | "payout" | "void" };

export type DealEventType = DealEvent["type"];

export interface DealContext {
  requiresHumanRelease: boolean;
  blockReason: string | null;
  hasPaypalAuth: boolean;
  /** true when authExpiresAt is in the future (computed by the caller). */
  authValid: boolean;
  hasDecision: boolean;
}

export interface TransitionResult {
  to: DealState;
  /** Side fields the executor sets on the Deal row. */
  set?: { requiresHumanRelease?: boolean; blockReason?: string | null };
}

export class TransitionError extends Error {
  constructor(
    public readonly from: DealState,
    public readonly event: DealEventType,
    public readonly reason: string,
  ) {
    super(`Cannot apply ${event} in ${from}: ${reason}`);
    this.name = "TransitionError";
  }
}

const CANCELLABLE: readonly DealState[] = ["DRAFT", "CONTRACTED", "GUARDED", "FLAGGED", "AWAITING_APPROVAL", "FUNDING"];
/** States holding an authorization that a void can release. */
const VOIDABLE: readonly DealState[] = ["LOCKED", "DELIVERED", "VERIFYING", "NEEDS_REVIEW", "SETTLEMENT_ERROR"];

export function transition(from: DealState, event: DealEvent, ctx: DealContext): TransitionResult {
  const fail = (reason: string): never => {
    throw new TransitionError(from, event.type, reason);
  };
  const need = (states: readonly DealState[]) => {
    if (!states.includes(from)) fail(`allowed only from ${states.join(", ")}`);
  };

  switch (event.type) {
    case "contract.created":
      need(["DRAFT"]);
      return { to: "CONTRACTED" };

    case "risk.assessed": {
      need(["CONTRACTED"]);
      if (event.policyCap) return { to: "FLAGGED", set: { blockReason: "POLICY_CAP" } };
      if (event.level === "HIGH" || event.policy === "block") return { to: "FLAGGED" };
      if (event.policy === "require_approval") return { to: "AWAITING_APPROVAL" };
      return { to: "GUARDED" };
    }

    case "buyer.override":
      need(["FLAGGED"]);
      if (ctx.blockReason === "POLICY_CAP") fail("a policy cap block cannot be overridden");
      if (!event.reason || event.reason.trim().length < 3) fail("an override needs a reason");
      return { to: "AWAITING_APPROVAL", set: { requiresHumanRelease: true } };

    case "buyer.approve":
      need(["AWAITING_APPROVAL"]);
      return { to: "GUARDED" };

    case "buyer.reject":
      need(["AWAITING_APPROVAL"]);
      return { to: "CANCELLED", set: { blockReason: "BUYER_CANCELLED" } };

    case "buyer.cancel":
      need(CANCELLABLE);
      return { to: "CANCELLED", set: { blockReason: "BUYER_CANCELLED" } };

    case "paypal.order.created":
      need(["GUARDED"]);
      if (!event.policyAllowed) fail("funding requires a policy ALLOW in the same transaction");
      return { to: "FUNDING" };

    case "paypal.authorization.created":
      need(["FUNDING"]);
      if (!event.verified) fail("authorization must match the stored order before LOCKED");
      return { to: "LOCKED" };

    case "funding.failed":
      need(["FUNDING"]);
      return { to: "CANCELLED", set: { blockReason: event.reason } };

    case "seller.deliverable.submitted":
      need(["LOCKED"]);
      return { to: "DELIVERED" };

    case "verifier.started":
      need(["DELIVERED"]);
      return { to: "VERIFYING" };

    case "verifier.invalid":
      need(["VERIFYING"]);
      return { to: "NEEDS_REVIEW" };

    case "verifier.decided": {
      need(["VERIFYING"]);
      const passes =
        event.outcome === "PASS" || (event.outcome === "PARTIAL" && event.score >= event.partialPayMin);
      if (!passes) {
        // FAIL is decided here; the deal is voided by settlement (settlement.voided).
        return { to: "VERIFYING" };
      }
      if (event.needsHumanReview || ctx.requiresHumanRelease) return { to: "NEEDS_REVIEW" };
      if (!ctx.hasDecision) fail("release requires a persisted Decision");
      if (!ctx.hasPaypalAuth || !ctx.authValid) fail("release requires a valid, unexpired authorization");
      return { to: "RELEASING" };
    }

    case "human.approve":
      need(["NEEDS_REVIEW"]);
      if (!ctx.hasDecision) fail("release requires a persisted Decision");
      if (!ctx.hasPaypalAuth || !ctx.authValid) fail("release requires a valid, unexpired authorization");
      return { to: "RELEASING" };

    case "human.reject":
      need(["NEEDS_REVIEW"]);
      // The void itself is settlement's job; this records the decision only.
      return { to: "NEEDS_REVIEW" };

    case "settlement.voided":
      need(VOIDABLE);
      if (event.reason === "REFUNDED") need(["SETTLEMENT_ERROR"]);
      return { to: "VOIDED", set: { blockReason: event.reason } };

    case "authorization.expired":
      need(["LOCKED", "DELIVERED", "VERIFYING", "NEEDS_REVIEW"]);
      return { to: "VOIDED", set: { blockReason: "AUTH_EXPIRED" } };

    case "settlement.released":
      need(["RELEASING"]);
      return { to: event.partial ? "RELEASED_PARTIAL" : "RELEASED" };

    case "settlement.failed":
      if (event.step === "void") need(VOIDABLE.filter((s) => s !== "SETTLEMENT_ERROR"));
      else need(["RELEASING"]);
      return { to: "SETTLEMENT_ERROR" };

    case "human.retry":
      need(["SETTLEMENT_ERROR"]);
      if (event.step === "void") return { to: "SETTLEMENT_ERROR" };
      if (!ctx.hasPaypalAuth) fail("retry requires an authorization");
      return { to: "RELEASING" };
  }
}

/** True if `event` is accepted in `from` given `ctx` (UI hints; server still enforces). */
export function can(from: DealState, event: DealEvent, ctx: DealContext): boolean {
  try {
    transition(from, event, ctx);
    return true;
  } catch (e) {
    if (e instanceof TransitionError) return false;
    throw e;
  }
}
