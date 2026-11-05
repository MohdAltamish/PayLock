import {
  addMoney,
  compareMoney,
  type DealState,
  type Money,
  type RiskLevel,
} from "@paylock/schemas";

/**
 * Policy Engine (invariant 8, ADR-003). Pure functions: inputs in, a result
 * with machine-readable reasons out. Callers persist the outcome as a
 * PolicyDecision in the same transaction as the action it approves.
 */

export type PolicyResult = "ALLOW" | "REQUIRE_APPROVAL" | "BLOCK";
export type PolicyAction =
  "guard" | "fund" | "authorize" | "capture" | "payout" | "void" | "refund";

export interface SpendPolicyInput {
  maxPerDeal: Money;
  dailyCap: Money;
  approvalThreshold: Money;
  allowMediumRisk: boolean;
}

export interface PolicyOutcome {
  action: PolicyAction;
  result: PolicyResult;
  reasons: string[];
  /** Everything the decision depended on; stored on the PolicyDecision row. */
  inputs: Record<string, unknown>;
  /** True when a spend cap blocked it (blockReason POLICY_CAP, no override). */
  policyCap: boolean;
}

/** Amended decision D: states whose amount counts toward the buyer's daily cap. */
export const DAILY_CAP_STATES: readonly DealState[] = [
  "LOCKED",
  "DELIVERED",
  "VERIFYING",
  "NEEDS_REVIEW",
  "RELEASING",
  "RELEASED",
  "RELEASED_PARTIAL",
  "SETTLEMENT_ERROR",
];

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function capReasons(amount: Money, policy: SpendPolicyInput, committedToday: Money): string[] {
  const out: string[] = [];
  if (compareMoney(amount, policy.maxPerDeal) > 0) out.push("AMOUNT_OVER_MAX_PER_DEAL");
  if (compareMoney(addMoney(committedToday, amount), policy.dailyCap) > 0)
    out.push("DAILY_CAP_EXCEEDED");
  return out;
}

const outcome = (
  action: PolicyAction,
  result: PolicyResult,
  reasons: string[],
  inputs: Record<string, unknown>,
  policyCap = false,
): PolicyOutcome => ({ action, result, reasons, inputs, policyCap });

/** After the Guardian: decides GUARDED, AWAITING_APPROVAL or FLAGGED. */
export function evaluateGuard(i: {
  level: RiskLevel;
  amount: Money;
  policy: SpendPolicyInput;
  committedToday: Money;
}): PolicyOutcome {
  const inputs = { ...i };
  const caps = capReasons(i.amount, i.policy, i.committedToday);
  if (caps.length) return outcome("guard", "BLOCK", caps, inputs, true);
  if (i.level === "HIGH") return outcome("guard", "BLOCK", ["RISK_HIGH"], inputs);
  const reasons: string[] = [];
  if (i.level === "MEDIUM") {
    if (i.policy.allowMediumRisk) reasons.push("RISK_MEDIUM_ALLOWED_BY_POLICY");
    else reasons.push("RISK_MEDIUM");
  }
  if (compareMoney(i.amount, i.policy.approvalThreshold) > 0) reasons.push("AMOUNT_OVER_THRESHOLD");
  const needsApproval =
    reasons.includes("RISK_MEDIUM") || reasons.includes("AMOUNT_OVER_THRESHOLD");
  if (needsApproval) return outcome("guard", "REQUIRE_APPROVAL", reasons, inputs);
  return outcome("guard", "ALLOW", reasons.length ? reasons : ["WITHIN_POLICY"], inputs);
}

/** Maps a guard outcome onto the state machine's risk.assessed policy field. */
export function guardPolicy(o: PolicyOutcome): "allow" | "require_approval" | "block" {
  return o.result === "ALLOW"
    ? "allow"
    : o.result === "REQUIRE_APPROVAL"
      ? "require_approval"
      : "block";
}

/** POST /fund: GUARDED -> FUNDING. */
export function evaluateFund(i: {
  state: DealState;
  freeze: boolean;
  amount: Money;
  policy: SpendPolicyInput;
  committedToday: Money;
}): PolicyOutcome {
  const inputs = { ...i };
  if (i.freeze) return outcome("fund", "BLOCK", ["FROZEN"], inputs);
  if (i.state !== "GUARDED") return outcome("fund", "BLOCK", ["INVALID_STATE"], inputs);
  const caps = capReasons(i.amount, i.policy, i.committedToday);
  if (caps.length) return outcome("fund", "BLOCK", caps, inputs, true);
  return outcome("fund", "ALLOW", ["WITHIN_POLICY"], inputs);
}

/**
 * Inside the /authorize transaction (amended decision D): FUNDING deals do not
 * count toward the cap, so it is checked again once the authorization exists.
 */
export function evaluateAuthorize(i: {
  freeze: boolean;
  amount: Money;
  policy: SpendPolicyInput;
  committedToday: Money;
}): PolicyOutcome {
  const inputs = { ...i };
  if (i.freeze) return outcome("authorize", "BLOCK", ["FROZEN"], inputs);
  const caps = capReasons(i.amount, i.policy, i.committedToday);
  if (caps.length) return outcome("authorize", "BLOCK", caps, inputs, true);
  return outcome("authorize", "ALLOW", ["WITHIN_POLICY"], inputs);
}

/** Capture for release (full or partial). */
export function evaluateCapture(i: {
  freeze: boolean;
  amount: Money;
  decision: { id: string; outcome: "PASS" | "PARTIAL" | "FAIL" } | null;
  humanApproved: boolean;
  requiresHumanRelease: boolean;
  authExpiresAt: Date | null;
  now: Date;
}): PolicyOutcome {
  const inputs = {
    freeze: i.freeze,
    amount: i.amount,
    decisionId: i.decision?.id ?? null,
    decisionOutcome: i.decision?.outcome ?? null,
    humanApproved: i.humanApproved,
    requiresHumanRelease: i.requiresHumanRelease,
    authExpiresAt: i.authExpiresAt?.toISOString() ?? null,
    now: i.now.toISOString(),
  };
  const reasons: string[] = [];
  if (!i.decision) reasons.push("NO_DECISION");
  if (i.freeze) reasons.push("FROZEN");
  if (!i.authExpiresAt || i.authExpiresAt.getTime() <= i.now.getTime())
    reasons.push("AUTH_EXPIRED");
  if (i.requiresHumanRelease && !i.humanApproved) reasons.push("HUMAN_RELEASE_REQUIRED");
  if (i.decision?.outcome === "FAIL" && !i.humanApproved) reasons.push("DECISION_FAIL");
  if (compareMoney(i.amount, "0.00") <= 0) reasons.push("ZERO_AMOUNT");
  if (reasons.length) return outcome("capture", "BLOCK", reasons, inputs);
  return outcome("capture", "ALLOW", ["DECISION_APPROVES_RELEASE"], inputs);
}

/** Payout only after the capture is COMPLETED, for exactly the captured amount (decision G). */
export function evaluatePayout(i: {
  freeze: boolean;
  amount: Money;
  capture: { status: string; amount: Money } | null;
}): PolicyOutcome {
  const inputs = { ...i };
  const reasons: string[] = [];
  if (i.freeze) reasons.push("FROZEN");
  if (!i.capture || i.capture.status !== "COMPLETED") reasons.push("CAPTURE_NOT_COMPLETED");
  else if (compareMoney(i.capture.amount, i.amount) !== 0)
    reasons.push("AMOUNT_NOT_CAPTURED_GROSS");
  if (reasons.length) return outcome("payout", "BLOCK", reasons, inputs);
  return outcome("payout", "ALLOW", ["CAPTURE_COMPLETED"], inputs);
}

/** Void returns funds to the buyer, so it is allowed even during a freeze (decision C). */
export function evaluateVoid(i: { freeze: boolean; reason: string }): PolicyOutcome {
  return outcome(
    "void",
    "ALLOW",
    i.freeze ? ["VOID_ALLOWED_DURING_FREEZE", i.reason] : [i.reason],
    { ...i },
  );
}

/** P2: refund a completed capture whose payout cannot succeed. */
export function evaluateRefund(i: {
  freeze: boolean;
  amount: Money;
  capture: { status: string; amount: Money } | null;
  payoutTerminallyFailed: boolean;
}): PolicyOutcome {
  const inputs = { ...i };
  const reasons: string[] = [];
  if (i.freeze) reasons.push("FROZEN");
  if (!i.capture || i.capture.status !== "COMPLETED") reasons.push("CAPTURE_NOT_COMPLETED");
  else if (compareMoney(i.capture.amount, i.amount) !== 0)
    reasons.push("AMOUNT_NOT_CAPTURED_GROSS");
  if (!i.payoutTerminallyFailed) reasons.push("PAYOUT_NOT_TERMINALLY_FAILED");
  if (reasons.length) return outcome("refund", "BLOCK", reasons, inputs);
  return outcome("refund", "ALLOW", ["PAYOUT_FAILED_AFTER_CAPTURE"], inputs);
}
