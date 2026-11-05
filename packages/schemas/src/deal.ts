import { z } from "zod";

export const DEAL_STATES = [
  "DRAFT",
  "CONTRACTED",
  "GUARDED",
  "FLAGGED",
  "AWAITING_APPROVAL",
  "FUNDING",
  "LOCKED",
  "DELIVERED",
  "VERIFYING",
  "NEEDS_REVIEW",
  "RELEASING",
  "RELEASED",
  "RELEASED_PARTIAL",
  "SETTLEMENT_ERROR",
  "VOIDED",
  "CANCELLED",
] as const;
export const DealState = z.enum(DEAL_STATES);
export type DealState = z.infer<typeof DealState>;

export const TERMINAL_STATES: readonly DealState[] = ["RELEASED", "RELEASED_PARTIAL", "VOIDED", "CANCELLED"];

export const RiskLevel = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const BlockReason = z.enum([
  "POLICY_CAP",
  "ORDER_MISMATCH",
  "AUTH_DECLINED",
  "AUTH_EXPIRED",
  "DEADLINE_PASSED",
  "FUNDING_TIMEOUT",
  "VERIFICATION_FAILED",
  "HUMAN_REJECTED",
  "BUYER_CANCELLED",
  "REFUNDED",
]);
export type BlockReason = z.infer<typeof BlockReason>;

/** The money state shown in the UI (UI_UX.md copy: reserved / released / returned). */
export type MoneyState = "none" | "reserving" | "reserved" | "releasing" | "released" | "returned" | "attention";

export function moneyState(state: DealState): MoneyState {
  switch (state) {
    case "FUNDING":
      return "reserving";
    case "LOCKED":
    case "DELIVERED":
    case "VERIFYING":
    case "NEEDS_REVIEW":
      return "reserved";
    case "RELEASING":
      return "releasing";
    case "RELEASED":
    case "RELEASED_PARTIAL":
      return "released";
    case "VOIDED":
      return "returned";
    case "SETTLEMENT_ERROR":
      return "attention";
    default:
      return "none";
  }
}
