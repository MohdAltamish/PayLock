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
  /** Models to try in order when the current one's daily quota is used up (LLM_MODEL_FALLBACKS). */
  fallbackModels?: string[];
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

  private modelIndex = 0;

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const models = [this.o.model, ...(this.o.fallbackModels ?? [])];
    for (;;) {
      try {
        return await this.completeWith(req, models[this.modelIndex]!);
      } catch (err) {
        const quota = err instanceof LlmError && err.status === 429 && !err.retryable;
        if (!quota || this.modelIndex >= models.length - 1) throw err;
        this.modelIndex++;
      }
    }
  }

  private async completeWith(req: LlmRequest, model: string): Promise<LlmResponse> {
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
      model,
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: user },
      ],
      response_format,
    });
    const maxRetries = this.o.maxRetries ?? 4;
    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now();
      let retryAfterMs = 0;
      try {
        const res = await this.f(url, {
          method: "POST",
          headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(this.o.timeoutMs),
        });
        const rawBody = (await res.json().catch(() => ({}))) as unknown;
        // Gemini's compatible endpoint wraps errors in an array.
        const data = (Array.isArray(rawBody) ? rawBody[0] : rawBody) as {
          choices?: Array<{ message?: { content?: string | null } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          model?: string;
          error?: { message?: string };
        };
        if (!res.ok) {
          const ra = Number(res.headers?.get("retry-after"));
          if (Number.isFinite(ra) && ra > 0) retryAfterMs = ra * 1000;
          const msg = data.error?.message ?? "";
          // A per-day quota will not clear within our retry window.
          const daily = /per[- ]day|RESOURCE_EXHAUSTED.*day/i.test(msg);
          const retryable = !daily && (res.status === 429 || res.status >= 500);
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
          model: data.model ?? model,
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
        await this.sleep(Math.min(30_000, retryAfterMs || 500 * 2 ** attempt));
      }
    }
  }
}
