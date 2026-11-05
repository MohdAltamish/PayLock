import {
  ContractOut,
  DecisionOut,
  recommendedAction,
  RiskOut,
  riskLevel,
  type Signal,
} from "@paylock/schemas";
import { ruleSignals, sumScore } from "./guardian/rules.js";
import type { Agents, GuardInput, NegotiateInput, VerifyInput } from "./types.js";

/**
 * Deterministic placeholder agents (AGENTS_MODE=stub, Phase 2). No LLM.
 * They exist so the deal core, settlement and curl paths can run before the
 * real agents land; outputs still go through the same Zod schemas.
 */
export class StubAgents implements Agents {
  async negotiate(input: NegotiateInput) {
    const price = extractPrice(input.request);
    const ambiguities: string[] = [];
    if (!price) ambiguities.push("No price found in the request");
    const title = input.request.replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled job";
    const contract = ContractOut.parse({
      title,
      scope: input.request.trim().slice(0, 2000) || title,
      price: price ?? "0.00",
      currency: "USD",
      deadline: null,
      criteria: [
        {
          id: "c1",
          description: "Deliverable is submitted as a URL or text",
          weight: 3,
          verifiable: "automatic",
        },
        {
          id: "c2",
          description: "Deliverable matches the requested scope",
          weight: 7,
          verifiable: "llm",
        },
      ],
      partialPayMin: 70,
      ambiguities: [...ambiguities, "Deadline not stated"],
    });
    return { contract, modelMeta: { mode: "stub" as const } };
  }

  async guard(input: GuardInput) {
    const signals: Signal[] = [...ruleSignals(input), ...keywordSignals(input)];
    const score = sumScore(signals);
    const level = riskLevel(score);
    const risk = RiskOut.parse({
      score,
      level,
      signals,
      summary: `Stub risk check: ${signals.length} signal(s), score ${score}. Risk: ${level}.`,
      recommendedAction: recommendedAction(level),
    });
    return { risk, fallback: false, modelMeta: { mode: "stub" as const } };
  }

  async verify(input: VerifyInput) {
    const text = `${input.deliverable.content} ${input.deliverable.note ?? ""}`;
    const fail = /\bFAIL\b|\/bad\b/i.test(text);
    const partial = !fail && /\bPARTIAL\b/i.test(text);
    const score = fail ? 40 : partial ? 80 : 100;
    const outcome = fail ? "FAIL" : partial ? "PARTIAL" : "PASS";
    const decision = DecisionOut.parse({
      outcome,
      score,
      perCriterion: input.contract.criteria.map((c, i) => ({
        criterionId: c.id,
        met: outcome === "PASS" || (outcome === "PARTIAL" && i === 0),
        confidence: 1,
        evidence: "stub verifier (keyword based)",
      })),
      reasoning: `Stub verifier: ${outcome}.`,
      payoutPercent: outcome === "PASS" ? 100 : outcome === "PARTIAL" ? score : 0,
      needsHumanReview: false,
    });
    return { decision, modelMeta: { mode: "stub" as const } };
  }
}

/** "$300", "300 USD", "budget 300.50". Returns a money string or null. */
export function extractPrice(text: string): string | null {
  const m =
    /\$\s?(\d{1,10}(?:,\d{3})*(?:\.\d{1,2})?)/.exec(text) ??
    /(\d{1,10}(?:\.\d{1,2})?)\s?(?:usd|dollars)\b/i.exec(text) ??
    /budget\D{0,5}(\d{1,10}(?:\.\d{1,2})?)/i.exec(text);
  if (!m?.[1]) return null;
  const [whole, frac = ""] = m[1].replace(/,/g, "").split(".");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

/** Stub-only stand-in for the LLM rubric: labelled as rule signals, never as AI. */
function keywordSignals(input: GuardInput): Signal[] {
  const text = input.messages.map((m) => m.body).join("\n");
  const out: Signal[] = [];
  if (/whats?app|telegram|zelle|wire|outside (paylock|paypal)|off[- ]platform/i.test(text))
    out.push({
      code: "OFF_PLATFORM_REQUEST",
      weight: 22,
      evidence: "keyword match (stub)",
      source: "rule",
    });
  if (/friends (and|&) family|\bf&f\b/i.test(text))
    out.push({
      code: "FRIENDS_FAMILY_REQUEST",
      weight: 20,
      evidence: "keyword match (stub)",
      source: "rule",
    });
  return out;
}
