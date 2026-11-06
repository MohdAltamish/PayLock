import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, existsSync, renameSync, writeFileSync } from "node:fs";
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

export interface RecordingOptions {
  /** false: one structured attempt per call (no schema retry), to save quota. Default true. */
  schemaRetry?: boolean;
  /** Where schema-invalid replies are moved for inspection (never served). Default: `.replay-tmp/rejected`. */
  rejectedDir?: string;
}

export class RecordingProvider implements LlmProvider {
  readonly kind: string;
  readonly schemaAttempts: 1 | 2;
  private readonly rejectedDir: string;
  constructor(
    private readonly inner: LlmProvider,
    private readonly dir: string,
    opts: RecordingOptions = {},
  ) {
    this.kind = `recording(${inner.kind})`;
    this.schemaAttempts = opts.schemaRetry === false ? 1 : 2;
    this.rejectedDir = opts.rejectedDir ?? path.resolve(".replay-tmp", "rejected");
  }

  /**
   * A reply that failed schema validation is moved out of the fixture dir,
   * so the next recording run calls the LLM again for that prompt only.
   */
  discard(fixture: string): void {
    const [name, key] = fixture.split("/");
    if (!name || !key || !/^[a-z_]+$/.test(name) || !/^[0-9a-f]{32}$/.test(key)) return;
    const from = path.join(this.dir, name, `${key}.json`);
    if (!existsSync(from)) return;
    const to = path.join(this.rejectedDir, name, `${key}.json`);
    mkdirSync(path.dirname(to), { recursive: true });
    renameSync(from, to);
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
