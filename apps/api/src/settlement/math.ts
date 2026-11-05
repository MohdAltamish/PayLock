import { percentOf, type Money } from "@paylock/schemas";

/**
 * Payment math (DESIGN.md section 7). Deterministic; the verifier's own
 * payoutPercent is advisory and never used to compute money.
 *
 * - PASS: 100%.
 * - PARTIAL with score >= partialPayMin: clamp(score, partialPayMin, 100).
 * - Anything else: null (FAIL, void the authorization).
 */
export function releasePercent(
  outcome: "PASS" | "PARTIAL" | "FAIL",
  score: number,
  partialPayMin: number,
): number | null {
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new RangeError("score 0-100");
  if (!Number.isInteger(partialPayMin) || partialPayMin < 0 || partialPayMin > 100)
    throw new RangeError("partialPayMin 0-100");
  if (outcome === "PASS") return 100;
  if (outcome === "PARTIAL" && score >= partialPayMin) {
    return Math.min(100, Math.max(partialPayMin, score));
  }
  return null;
}

/** Capture amount: round_down(amount * percent / 100, 2), never above the authorization. */
export function captureAmount(authorized: Money, percent: number): Money {
  return percentOf(authorized, percent);
}
