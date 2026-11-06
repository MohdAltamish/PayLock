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
  /**
   * Structured attempts per call: 2 (default) allows one retry with the
   * validation error appended; 1 disables it (fixture recording, to save quota).
   */
  readonly schemaAttempts?: 1 | 2;
  complete(req: LlmRequest): Promise<LlmResponse>;
  /** Called by structured() when a reply failed validation, so a recorder can drop its fixture. */
  discard?(fixture: string): void;
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
