import { z } from "zod";
import { Currency, Money } from "./money.js";

/**
 * Agent output schemas (DESIGN.md section 5, invariant 5). Every agent result
 * is parsed with these before it is stored or acted on. Money is a Decimal
 * string, never a number.
 */

export const AcceptanceCriterion = z.object({
  id: z.string().min(1).max(40),
  description: z.string().min(1).max(400),
  weight: z.number().int().min(1).max(10),
  verifiable: z.enum(["automatic", "llm", "human"]),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

export const ContractOut = z.object({
  title: z.string().min(1).max(120),
  scope: z.string().min(1).max(2000),
  price: Money,
  currency: Currency,
  deadline: z.iso.datetime({ offset: true }).nullable(),
  criteria: z.array(AcceptanceCriterion).min(1).max(10),
  partialPayMin: z.number().int().min(0).max(100).default(70),
  ambiguities: z.array(z.string().max(300)).max(10),
});
export type ContractOut = z.infer<typeof ContractOut>;

export const SIGNAL_CODES_RULE = [
  "NEW_ACCOUNT",
  "PAYOUT_EMAIL_CHANGED_RECENTLY",
  "PAYOUT_EMAIL_MISMATCH",
  "ZERO_HISTORY",
  "HIGH_FAILURE_RATE",
  "DISPUTES",
  "REPORTS",
  "VELOCITY",
  "UNDER_THRESHOLD_SPLITTING",
  "PAYPAL_UNVERIFIED",
  "ESTABLISHED",
] as const;

export const SIGNAL_CODES_LLM = [
  "OFF_PLATFORM_REQUEST",
  "UPFRONT_FEE_REQUEST",
  "FRIENDS_FAMILY_REQUEST",
  "URGENCY_PRESSURE",
  "OVERPAYMENT_SCHEME",
  "IDENTITY_MISMATCH",
  "TOO_GOOD_PRICING",
] as const;
export type LlmSignalCode = (typeof SIGNAL_CODES_LLM)[number];

export const Signal = z.object({
  code: z.string().min(1).max(60),
  weight: z.number().min(-100).max(100),
  evidence: z.string().max(300),
  source: z.enum(["rule", "llm"]),
});
export type Signal = z.infer<typeof Signal>;

export const RiskLevelOut = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const RiskOut = z.object({
  score: z.number().int().min(0).max(100),
  level: RiskLevelOut,
  signals: z.array(Signal),
  summary: z.string().max(400),
  recommendedAction: z.enum(["allow", "require_approval", "block"]),
});
export type RiskOut = z.infer<typeof RiskOut>;

/** What the Guardian's LLM step returns: only rubric signals, never a score. */
export const LlmSignalsOut = z.object({
  signals: z
    .array(
      z.object({
        code: z.enum(SIGNAL_CODES_LLM),
        confidence: z.number().min(0).max(1),
        evidence: z.string().max(300),
      }),
    )
    .max(7),
  summary: z.string().max(400),
});
export type LlmSignalsOut = z.infer<typeof LlmSignalsOut>;

export const CriterionResult = z.object({
  criterionId: z.string().min(1).max(40),
  met: z.boolean(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(500),
});
export type CriterionResult = z.infer<typeof CriterionResult>;

export const DecisionOut = z.object({
  outcome: z.enum(["PASS", "PARTIAL", "FAIL"]),
  score: z.number().int().min(0).max(100),
  perCriterion: z.array(CriterionResult),
  reasoning: z.string().max(800),
  payoutPercent: z.number().int().min(0).max(100),
  needsHumanReview: z.boolean(),
});
export type DecisionOut = z.infer<typeof DecisionOut>;

/** Risk level bands (DESIGN.md section 6). */
export function riskLevel(score: number): "LOW" | "MEDIUM" | "HIGH" {
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

export function recommendedAction(level: "LOW" | "MEDIUM" | "HIGH") {
  return level === "LOW" ? "allow" : level === "MEDIUM" ? "require_approval" : "block";
}
