import { ContractOut, type ContractOut as ContractT } from "@paylock/schemas";
import type { ReadSkills } from "@paylock/skills";
import { structured } from "../llm/structured.js";
import type { LlmProvider } from "../llm/types.js";
import { fence, UNTRUSTED_NOTICE } from "./fence.js";
import { extractPrice } from "./stub.js";
import type { NegotiateInput, NegotiateResult } from "./types.js";

/** Negotiator (AI_AGENTS.md section 1). Temperature 0.2, 1500 tokens, one schema retry. */
export const NEGOTIATOR_SYSTEM = `You are the Paylock Negotiator. Convert the buyer's request into a structured contract.
Rules:
- Produce 2-6 acceptance criteria. Each must be concrete and testable.
- Every criterion must come from something the buyer actually asked for. Never add requirements they did not state (no minimum counts, page structure, navigation, SEO, performance, accessibility or styling rules unless requested).
- Mark each criterion verifiable as:
  - "automatic" only for a website or hosted page, and only for: the page loads, the page declares a mobile viewport, the page has a form;
  - "llm" for content judgment from the delivered text or page (sections present, topic covered, correct language, facts mentioned);
  - "human" only for purely subjective approval the buyer explicitly asks to give themselves.
- For text work (copy, translation, captions), every criterion is "llm"; there is no URL to check.
- Paylock checks a delivered URL with one plain HTTP GET (no browser, no clicking, no form submission). Never write criteria that need interaction or visual rendering, such as "the form submits" or "looks good on a phone"; say "the page has a contact form" or "the page declares a mobile viewport" instead.
- Do not add criteria about the delivery format, deadlines or communication.
- Weight criteria 1-10 by importance to the buyer's stated goal.
- Criterion ids are "c1", "c2", ... in order.
- Price and currency must come from the request, as a decimal string with two decimals (e.g. "300.00") and currency "USD". If no price is given, set price "0.00" and add an ambiguity.
- Never invent deadlines. Relative dates such as "by Friday" cannot be resolved: set deadline null and add an ambiguity. Use an ISO 8601 datetime only for an explicit calendar date and time.
- partialPayMin is 70 unless the buyer states otherwise.
- title: at most 80 characters.
${UNTRUSTED_NOTICE}
Output JSON matching the schema only.`;

export class Negotiator {
  constructor(
    private readonly llm: LlmProvider,
    private readonly skills: Pick<ReadSkills, "estimate_market_price">,
  ) {}

  async run(input: NegotiateInput): Promise<NegotiateResult> {
    const market = this.skills.estimate_market_price(input.request);
    const user = [
      fence("REQUEST", input.request),
      input.sellerReply ? fence("MESSAGE", input.sellerReply, { from: "seller" }) : "",
      fence("TOOL_RESULT", JSON.stringify({ tool: "estimate_market_price", result: market }), {
        tool: "estimate_market_price",
      }),
    ]
      .filter(Boolean)
      .join("\n\n");
    const r = await structured(this.llm, {
      name: "negotiator_contract",
      schema: ContractOut,
      system: NEGOTIATOR_SYSTEM,
      user,
      temperature: 0.2,
      maxTokens: 1500,
    }).catch((err: Error) => ({
      ok: false as const,
      error: err.message,
      attempts: 0,
      meta: undefined,
    }));
    if (r.ok) {
      const contract = r.value;
      // Ids must be unique for the verifier to map results back.
      const ids = new Set(contract.criteria.map((c) => c.id));
      if (ids.size === contract.criteria.length) {
        return { contract, modelMeta: { mode: "live", ...r.meta, schemaValid: true } };
      }
    }
    // AI_AGENTS.md: return a draft the buyer must edit.
    return {
      contract: fallbackContract(input.request),
      modelMeta: {
        mode: "live",
        schemaValid: false,
        error: r.ok ? "duplicate criterion ids" : r.error,
        ...(r.meta ?? {}),
      },
    };
  }
}

export function fallbackContract(request: string): ContractT {
  const price = extractPrice(request) ?? "0.00";
  return ContractOut.parse({
    title: request.replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled job",
    scope: request.trim().slice(0, 2000) || "Untitled job",
    price,
    currency: "USD",
    deadline: null,
    criteria: [
      {
        id: "c1",
        description: "Deliverable matches the request as written",
        weight: 10,
        verifiable: "human",
      },
    ],
    partialPayMin: 70,
    ambiguities: ["Could not structure request"],
  });
}
