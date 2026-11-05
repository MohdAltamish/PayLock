import { compareMoney, parseMoney, type Signal } from "@paylock/schemas";
import type { GuardInput } from "../types.js";

/**
 * Deterministic Guardian signals (DESIGN.md section 6, ADR-005). Pure.
 * Weights are fixed and explainable; the LLM never changes them.
 */
export function ruleSignals(i: GuardInput): Signal[] {
  const s = i.seller;
  const out: Signal[] = [];
  const add = (code: string, weight: number, evidence: string) =>
    out.push({ code, weight, evidence, source: "rule" });

  if (s.accountAgeDays < 7) add("NEW_ACCOUNT", 25, `account age ${fmtDays(s.accountAgeDays)}`);
  if (s.hoursSincePayoutEmailChange !== null && s.hoursSincePayoutEmailChange < 24)
    add(
      "PAYOUT_EMAIL_CHANGED_RECENTLY",
      25,
      `payout email changed ${fmtHours(s.hoursSincePayoutEmailChange)} ago`,
    );
  if (s.contactDomain && s.payoutDomain && s.contactDomain !== s.payoutDomain)
    add("PAYOUT_EMAIL_MISMATCH", 15, "payout email domain differs from contact email domain");
  if (s.completedDeals === 0) add("ZERO_HISTORY", 10, "no completed deals");
  const n = s.completedDeals + s.failedDeals;
  if (n >= 3 && s.failedDeals / n > 0.3)
    add("HIGH_FAILURE_RATE", 20, `${s.failedDeals} of ${n} deals failed`);
  if (s.disputes > 0) add("DISPUTES", Math.min(30, 15 * s.disputes), `${s.disputes} dispute(s)`);
  if (s.reportsReceived > 0)
    add("REPORTS", Math.min(30, 10 * s.reportsReceived), `${s.reportsReceived} report(s)`);
  if (i.velocity10m > 5) add("VELOCITY", 20, `${i.velocity10m} deals in 10 minutes`);
  if (isJustUnderThreshold(i.amount, i.approvalThreshold) && i.nearThresholdDeals24h > 2)
    add(
      "UNDER_THRESHOLD_SPLITTING",
      20,
      `${i.nearThresholdDeals24h} deals just under the approval threshold in 24h`,
    );
  if (!s.paypalVerified) add("PAYPAL_UNVERIFIED", 10, "seller PayPal account not verified");
  if (i.payerAccountStatus === "UNVERIFIED")
    add("PAYPAL_UNVERIFIED", 10, "payer PayPal account not verified");
  if (s.accountAgeDays > 90 && s.completedDeals >= 10 && s.disputes === 0)
    add("ESTABLISHED", -20, `${s.completedDeals} completed deals, no disputes`);
  return out;
}

/** Within 5% below the threshold (inclusive of the threshold itself). */
export function isJustUnderThreshold(amount: string, threshold: string): boolean {
  const lower = parseMoney(threshold).mul(0.95).toFixed(2);
  return compareMoney(amount, threshold) <= 0 && compareMoney(amount, lower) >= 0;
}

export function sumScore(signals: Signal[]): number {
  const total = signals.reduce((acc, s) => acc + s.weight, 0);
  return Math.max(0, Math.min(100, Math.round(total)));
}

function fmtDays(d: number): string {
  return d < 1 ? "under 1 day" : `${Math.floor(d)} day${Math.floor(d) === 1 ? "" : "s"}`;
}
function fmtHours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} minutes`;
  return `${Math.floor(h)} hour${Math.floor(h) === 1 ? "" : "s"}`;
}
