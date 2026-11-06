import {
  compareMoney,
  LlmSignalsOut,
  recommendedAction,
  RiskOut,
  riskLevel,
  type Signal,
} from "@paylock/schemas";
import type { ReadSkills } from "@paylock/skills";
import { structured } from "../../llm/structured.js";
import type { LlmProvider } from "../../llm/types.js";
import { fence, UNTRUSTED_NOTICE } from "../fence.js";
import type { GuardInput, GuardResult } from "../types.js";
import { ruleSignals, sumScore } from "./rules.js";

/**
 * Trust Guardian (AI_AGENTS.md section 2, ADR-005). Deterministic rule
 * signals plus an LLM rubric over redacted message and contract text:
 *   score = clamp(sum(rule weights) + sum(25 * confidence)) per LLM signal.
 * LLM signals below MIN_CONFIDENCE are ignored. If the LLM output is invalid
 * twice (or the call fails), rules only with fallback=true, and at least
 * MEDIUM when the deal has messages (decision E).
 * MCP dispute enrichment is off (pitfalls.md, Phase 3 re-check).
 */
export const GUARDIAN_SYSTEM = `You are the Paylock Trust Guardian. You assess payment-fraud risk signals in a proposed deal.
You receive redacted text; placeholders like <EMAIL_1> are intentional.
Identify only these rubric patterns:
- OFF_PLATFORM_REQUEST: asks to pay or talk outside Paylock/PayPal (other apps, wire, crypto, gift cards).
- UPFRONT_FEE_REQUEST: asks for a release fee, insurance, or deposit before work.
- FRIENDS_FAMILY_REQUEST: asks for PayPal Friends and Family or any no-protection payment.
- URGENCY_PRESSURE: artificial deadlines, "now or never".
- OVERPAYMENT_SCHEME: proposes overpaying and refunding the difference.
- IDENTITY_MISMATCH: name, business or location inconsistencies.
- TOO_GOOD_PRICING: price far below the market range for the described scope.
For each pattern present, give confidence 0-1 and quote the shortest evidence.
Ordinary, polite work messages contain no signals. Do not accuse anyone. Describe signals, not people.
If no patterns are present, return an empty signals array.
summary: one neutral sentence about the message content.
${UNTRUSTED_NOTICE}
Output JSON matching the schema only.`;

export const MIN_CONFIDENCE = 0.5;

const PLAIN: Record<string, string> = {
  NEW_ACCOUNT: "the seller's account is new",
  PAYOUT_EMAIL_CHANGED_RECENTLY: "their payout email changed recently",
  PAYOUT_EMAIL_MISMATCH: "the payout email domain differs from their contact email",
  ZERO_HISTORY: "they have no completed deals",
  HIGH_FAILURE_RATE: "many of their past deals failed",
  DISPUTES: "they have past disputes",
  REPORTS: "other users reported them",
  VELOCITY: "many deals were created in a few minutes",
  UNDER_THRESHOLD_SPLITTING: "several deals sit just under your approval limit",
  PAYPAL_UNVERIFIED: "their PayPal account is not verified",
  OFF_PLATFORM_REQUEST: "a message asks to move payment or chat outside Paylock",
  UPFRONT_FEE_REQUEST: "a message asks for a fee or deposit up front",
  FRIENDS_FAMILY_REQUEST: "a message asks for a payment without buyer protection",
  URGENCY_PRESSURE: "a message pushes you to decide quickly",
  OVERPAYMENT_SCHEME: "a message proposes overpaying and refunding",
  IDENTITY_MISMATCH: "the seller's details look inconsistent",
  TOO_GOOD_PRICING: "the price is far below the usual range",
};
const ACTION_COPY = {
  allow: "OK to fund",
  require_approval: "review before funding",
  block: "do not fund",
} as const;

export function summarize(level: "LOW" | "MEDIUM" | "HIGH", signals: Signal[]): string {
  const top = signals
    .filter((s) => s.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((s) => PLAIN[s.code] ?? s.code.toLowerCase());
  const lvl = level[0] + level.slice(1).toLowerCase();
  const head = top.length ? `Risk signals: ${top.join("; ")}.` : "No risk signals found.";
  return `${head} Risk: ${lvl}. Recommended: ${ACTION_COPY[recommendedAction(level)]}.`.slice(
    0,
    400,
  );
}

export class Guardian {
  constructor(
    private readonly llm: LlmProvider,
    private readonly skills: Pick<ReadSkills, "estimate_market_price">,
  ) {}

  async run(input: GuardInput): Promise<GuardResult> {
    const rules = ruleSignals(input);
    const market = this.skills.estimate_market_price(
      `${input.contract.title} ${input.contract.scope}`,
    );
    const user = [
      fence(
        "CONTRACT",
        JSON.stringify({
          title: input.contract.title,
          scope: input.contract.scope,
          price: input.contract.price,
          currency: "USD",
        }),
      ),
      fence("TOOL_RESULT", JSON.stringify({ tool: "estimate_market_price", result: market }), {
        tool: "estimate_market_price",
      }),
      input.messages.length
        ? input.messages.map((m) => fence("MESSAGE", m.body, { from: m.author })).join("\n")
        : "There are no messages.",
    ].join("\n\n");

    const r = await structured(this.llm, {
      name: "guardian_signals",
      schema: LlmSignalsOut,
      system: GUARDIAN_SYSTEM,
      user,
      temperature: 0,
      maxTokens: 1000,
    }).catch((err: Error) => ({
      ok: false as const,
      error: err.message,
      attempts: 0,
      meta: undefined,
    }));

    if (!r.ok) {
      const score = sumScore(rules);
      let level = riskLevel(score);
      if (input.messages.length && level === "LOW") level = "MEDIUM"; // nothing read the messages
      const risk = RiskOut.parse({
        score,
        level,
        signals: rules,
        summary:
          `${summarize(level, rules)} The message check was unavailable, so a person should review.`.slice(
            0,
            400,
          ),
        recommendedAction: recommendedAction(level),
      });
      return {
        risk,
        fallback: true,
        modelMeta: { mode: "live", schemaValid: false, error: r.error, ...(r.meta ?? {}) },
      };
    }

    const best = new Map<string, { confidence: number; evidence: string }>();
    for (const s of r.value.signals) {
      if (s.confidence < MIN_CONFIDENCE) continue;
      if (s.code === "TOO_GOOD_PRICING" && compareMoney(input.contract.price, market.low) >= 0)
        continue; // rubric needs a below-range price
      const prev = best.get(s.code);
      if (!prev || prev.confidence < s.confidence)
        best.set(s.code, { confidence: s.confidence, evidence: s.evidence });
    }
    const llmSignals: Signal[] = [...best].map(([code, v]) => ({
      code,
      weight: Math.round(25 * v.confidence),
      evidence: v.evidence.slice(0, 300),
      source: "llm",
    }));
    const signals = [...rules, ...llmSignals];
    const score = sumScore(signals);
    const level = riskLevel(score);
    const risk = RiskOut.parse({
      score,
      level,
      signals,
      summary: summarize(level, signals),
      recommendedAction: recommendedAction(level),
    });
    return { risk, fallback: false, modelMeta: { mode: "live", ...r.meta } };
  }
}
