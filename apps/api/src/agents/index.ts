import type { Config } from "../config/env.js";
import type { PayPalLogger } from "../paypal/http.js";
import { StubAgents } from "./stub.js";
import type { Agents } from "./types.js";

/** Picks the agent implementation for AGENTS_MODE. Live and replay arrive in Phase 3. */
export async function createAgents(
  config: Config,
  _log: Pick<PayPalLogger, "info" | "warn">,
): Promise<Agents> {
  if (config.agentsMode === "stub") return new StubAgents();
  throw new Error(`AGENTS_MODE=${config.agentsMode} is not available yet`);
}
