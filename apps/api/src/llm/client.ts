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
 */
export function createLlm(
  config: Config,
  onStats?: (name: string, stats: Record<string, number>) => void,
): LlmProvider {
  const replayDir = config.llm.replayDir;
  if (config.agentsMode === "replay" || config.llm.provider === "replay")
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
          jsonMode: config.llm.jsonMode,
          timeoutMs: config.llm.timeoutMs,
        });
  return new RedactingProvider(
    config.llm.record ? new RecordingProvider(live, replayDir) : live,
    onStats,
  );
}
