import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types.js";

/**
 * Replay provider (Task 12). Fixtures are keyed by sha256 of the schema name
 * and the exact (already redacted) prompts, so a recorded run returns
 * identical outputs every time and the demo never depends on a live LLM.
 *
 * - ReplayProvider: serves fixtures; a missing fixture is an error (never a
 *   silent live call).
 * - RecordingProvider: calls the live provider and writes the reply.
 * Fixtures contain redacted prompts only (no PII, no keys).
 */
export interface ReplayFixture {
  key: string;
  name: string;
  model: string;
  system: string;
  user: string;
  text: string;
  recordedAt: string;
}

export function replayKey(req: Pick<LlmRequest, "name" | "system" | "user">): string {
  return createHash("sha256")
    .update(`${req.name}\n${req.system}\n${req.user}`)
    .digest("hex")
    .slice(0, 32);
}

const file = (dir: string, req: Pick<LlmRequest, "name">, key: string) =>
  path.join(dir, req.name, `${key}.json`);

export class ReplayMissError extends Error {
  constructor(
    public readonly key: string,
    name: string,
  ) {
    super(`No replay fixture for ${name} (${key}). Record it with LLM_RECORD=1.`);
    this.name = "ReplayMissError";
  }
}

export class ReplayProvider implements LlmProvider {
  readonly kind = "replay";
  /** `fallback` (LLM_REPLAY_FALLBACK=live): on a miss, call it instead of failing. Off by default. */
  constructor(
    private readonly dir: string,
    private readonly fallback?: LlmProvider,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const key = replayKey(req);
    const f = file(this.dir, req, key);
    if (!existsSync(f)) {
      if (this.fallback) return this.fallback.complete(req);
      throw new ReplayMissError(key, req.name);
    }
    const fx = JSON.parse(readFileSync(f, "utf8")) as ReplayFixture;
    return { text: fx.text, model: fx.model, latencyMs: 0, fixture: `${req.name}/${key}` };
  }
}

export class RecordingProvider implements LlmProvider {
  readonly kind: string;
  constructor(
    private readonly inner: LlmProvider,
    private readonly dir: string,
  ) {
    this.kind = `recording(${inner.kind})`;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const key = replayKey(req);
    const f = file(this.dir, req, key);
    // Already recorded: reuse it (saves quota; set LLM_RERECORD=1 to refresh).
    if (existsSync(f) && process.env.LLM_RERECORD !== "1") {
      const fx = JSON.parse(readFileSync(f, "utf8")) as ReplayFixture;
      return { text: fx.text, model: fx.model, latencyMs: 0, fixture: `${req.name}/${key}` };
    }
    const res = await this.inner.complete(req);
    mkdirSync(path.dirname(f), { recursive: true });
    const fx: ReplayFixture = {
      key,
      name: req.name,
      model: res.model,
      system: req.system,
      user: req.user,
      text: res.text,
      recordedAt: new Date().toISOString(),
    };
    writeFileSync(f, JSON.stringify(fx, null, 2) + "\n");
    return { ...res, fixture: `${req.name}/${key}` };
  }
}
