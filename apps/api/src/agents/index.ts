import { readSkills, type ReadSkills } from "@paylock/skills";
import type { Config } from "../config/env.js";
import { createLlm } from "../llm/client.js";
import type { LlmProvider } from "../llm/types.js";
import type { PayPalLogger } from "../paypal/http.js";
import { Guardian } from "./guardian/index.js";
import { Negotiator } from "./negotiator.js";
import { StubAgents } from "./stub.js";
import type { Agents } from "./types.js";
import { Verifier } from "./verifier/index.js";

/**
 * Orchestrator wiring (decision H): the orchestrator calls read-only skills
 * and fences their results into prompts; agents never get write skills and
 * there is no open-ended tool loop.
 */
export class LlmAgents implements Agents {
  private readonly negotiator: Negotiator;
  private readonly guardian: Guardian;
  private readonly verifier: Verifier;

  constructor(llm: LlmProvider, skills: Readonly<ReadSkills>, appUrl?: string) {
    this.negotiator = new Negotiator(llm, skills);
    this.guardian = new Guardian(llm, skills);
    this.verifier = new Verifier({ llm, skills, appUrl });
  }

  negotiate: Agents["negotiate"] = (i) => this.negotiator.run(i);
  guard: Agents["guard"] = (i) => this.guardian.run(i);
  verify: Agents["verify"] = (i) => this.verifier.run(i);
}

export function skillsFor(config: Config): Readonly<ReadSkills> {
  return readSkills({
    fetch: { allowHosts: config.fetchUrlDevAllowHosts },
    runChecksEnabled: config.runChecksEnabled,
  });
}

/** Picks the agent implementation for AGENTS_MODE (stub | live | replay). */
export async function createAgents(
  config: Config,
  log: Pick<PayPalLogger, "info" | "warn">,
): Promise<Agents> {
  if (config.agentsMode === "stub") return new StubAgents();
  const llm = createLlm(config, (name, stats) =>
    log.info({ llm_call: name, redacted: stats }, "llm prompt redacted"),
  );
  return new LlmAgents(llm, skillsFor(config), config.appUrl);
}
