import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types.js";

/**
 * Anthropic Messages API with a forced tool call: the tool's input schema is
 * the output schema, and tool_choice forces it, so the reply is structured.
 * Not exercised live in this project (the configured provider is openai);
 * covered by a unit test with a fake fetch.
 */
export interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export class AnthropicProvider implements LlmProvider {
  readonly kind = "anthropic";
  constructor(private readonly o: AnthropicOptions) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const f = this.o.fetch ?? ((i, init) => fetch(i, init));
    const t0 = Date.now();
    const res = await f(
      `${(this.o.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "")}/v1/messages`,
      {
        method: "POST",
        headers: {
          "x-api-key": this.o.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.o.model,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
          tools: [
            {
              name: req.name,
              description: `Return the ${req.name} result`,
              input_schema: req.jsonSchema,
            },
          ],
          tool_choice: { type: "tool", name: req.name },
        }),
        signal: AbortSignal.timeout(this.o.timeoutMs),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      content?: Array<{ type: string; name?: string; input?: unknown }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
      error?: { message?: string };
    };
    if (!res.ok)
      throw new LlmError(
        `LLM HTTP ${res.status}: ${data.error?.message?.slice(0, 160) ?? ""}`,
        res.status,
        res.status >= 500 || res.status === 429,
      );
    const tool = data.content?.find((c) => c.type === "tool_use" && c.name === req.name);
    return {
      text: tool ? JSON.stringify(tool.input) : "",
      model: data.model ?? this.o.model,
      latencyMs: Date.now() - t0,
      usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens },
    };
  }
}
