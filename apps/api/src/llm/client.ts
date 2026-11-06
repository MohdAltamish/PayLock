import type { Config } from "../config/env.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAiProvider } from "./openai.js";
import { RedactingProvider } from "./redaction.js";
import { RecordingProvider, ReplayProvider } from "./replay.js";
import type { LlmProvider } from "./types.js";

/**
 * Builds the LlmClient stack. Redaction is always the outermost layer
 * (invariant 7): replay fixtures and the live provider only ever see
 * redacted prompts.
 *
 *   AGENTS_MODE=replay            -> Redacting(Replay)
 *   AGENTS_MODE=live, LLM_RECORD  -> Redacting(Recording(OpenAI|Anthropic))
 *   AGENTS_MODE=live              -> Redacting(OpenAI|Anthropic)
 *   AGENTS_MODE=replay + LLM_REPLAY_FALLBACK=live -> Redacting(Replay -> live on a miss)
 */
export type LlmConfig = Pick<Config, "agentsMode" | "llm">;

export function createLlm(
  config: LlmConfig,
  onStats?: (name: string, stats: Record<string, number>) => void,
): LlmProvider {
  const replayDir = config.llm.replayDir;
  const replay = config.agentsMode === "replay" || config.llm.provider === "replay";
  if (replay && !(config.llm.replayFallback && config.llm.apiKey && config.llm.model))
    return new RedactingProvider(new ReplayProvider(replayDir), onStats);
  const live: LlmProvider =
    config.llm.provider === "anthropic"
      ? new AnthropicProvider({
          apiKey: config.llm.apiKey!,
          model: config.llm.model!,
          timeoutMs: config.llm.timeoutMs,
        })
      : new OpenAiProvider({
          baseUrl: config.llm.baseUrl,
          apiKey: config.llm.apiKey!,
          model: config.llm.model!,
          fallbackModels: config.llm.fallbackModels,
          jsonMode: config.llm.jsonMode,
          timeoutMs: config.llm.timeoutMs,
        });
  return new RedactingProvider(
    // Recording spends the shared daily quota: no schema retry; invalid replies
    // are dropped from the fixtures so a re-run re-records only those.
    config.llm.record ? new RecordingProvider(live, replayDir, { schemaRetry: false }) : live,
    onStats,
  );
}
