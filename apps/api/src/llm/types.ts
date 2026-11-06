/**
 * LLM boundary (Task 12). Providers take a system prompt, a user prompt and a
 * JSON schema, and return raw text. Parsing and validation live in
 * structured.ts; PII redaction wraps every provider (redaction.ts).
 */
export interface LlmRequest {
  /** Stable name of the output schema, e.g. "guardian_signals". Used for replay fixtures. */
  name: string;
  system: string;
  user: string;
  /** JSON Schema for the output (OpenAI strict json_schema / Anthropic tool input). */
  jsonSchema: Record<string, unknown>;
  temperature: number;
  maxTokens: number;
  /** Person names the redaction middleware must tokenize; stripped before the provider sees the request. */
  knownNames?: string[];
}

export interface LlmResponse {
  text: string;
  model: string;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Set by the replay provider. */
  fixture?: string;
}

export interface LlmProvider {
  readonly kind: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
