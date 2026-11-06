import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types.js";

/**
 * OpenAI-compatible chat completions provider. LLM_BASE_URL points it at any
 * compatible endpoint; for this project, Gemini's OpenAI-compatible API.
 *
 * Task 12 probe (scripts/llm-probe.ts, 2026-11-05): that endpoint honored
 * strict `json_schema` 3/3 and ignored the schema with `json_object` 0/3, so
 * json_schema is the default. json_object stays available (LLM_JSON_MODE)
 * because Zod validates every reply either way.
 */
export interface OpenAiOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  jsonMode: "json_schema" | "json_object";
  timeoutMs: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class OpenAiProvider implements LlmProvider {
  readonly kind = "openai";
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly o: OpenAiOptions) {
    this.f = o.fetch ?? ((i, init) => fetch(i, init));
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const url = `${this.o.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const response_format =
      this.o.jsonMode === "json_schema"
        ? {
            type: "json_schema",
            json_schema: { name: req.name, strict: true, schema: req.jsonSchema },
          }
        : { type: "json_object" };
    const user =
      this.o.jsonMode === "json_object"
        ? `${req.user}\n\nReply with one JSON object matching this JSON Schema:\n${JSON.stringify(req.jsonSchema)}`
        : req.user;
    const body = JSON.stringify({
      model: this.o.model,
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: user },
      ],
      response_format,
    });
    const maxRetries = this.o.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now();
      try {
        const res = await this.f(url, {
          method: "POST",
          headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(this.o.timeoutMs),
        });
        const data = (await res.json().catch(() => ({}))) as {
          choices?: Array<{ message?: { content?: string | null } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          model?: string;
          error?: { message?: string };
        };
        if (!res.ok) {
          const retryable = res.status === 429 || res.status >= 500;
          // Never include the request or key; the provider's message is short and safe.
          throw new LlmError(
            `LLM HTTP ${res.status}: ${data.error?.message?.slice(0, 160) ?? ""}`,
            res.status,
            retryable,
          );
        }
        const text = data.choices?.[0]?.message?.content ?? "";
        return {
          text,
          model: data.model ?? this.o.model,
          latencyMs: Date.now() - t0,
          usage: {
            inputTokens: data.usage?.prompt_tokens,
            outputTokens: data.usage?.completion_tokens,
          },
        };
      } catch (err) {
        const e =
          err instanceof LlmError
            ? err
            : new LlmError(`LLM request failed: ${(err as Error).name}`, undefined, true);
        if (!e.retryable || attempt >= maxRetries) throw e;
        await this.sleep(500 * 2 ** attempt);
      }
    }
  }
}
