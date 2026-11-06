import { z } from "zod";
import type { LlmProvider, LlmResponse } from "./types.js";

/**
 * Structured output (invariant 5). The schema is sent to the provider as JSON
 * Schema, the reply is parsed and validated with Zod, and an invalid reply
 * gets exactly one retry with the validation error appended. A second failure
 * returns `ok: false` so the caller can fail safe (rules fallback or
 * NEEDS_REVIEW). Free text is never parsed for decisions.
 */
export interface StructuredRequest<T> {
  name: string;
  schema: z.ZodType<T>;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  /** Display names to redact (passed through to the redaction middleware). */
  knownNames?: string[];
}

export type StructuredResult<T> =
  | { ok: true; value: T; attempts: number; meta: LlmMeta }
  | { ok: false; error: string; attempts: number; meta: LlmMeta };

export interface LlmMeta {
  model?: string;
  latencyMs: number;
  attempts: number;
  fixtures: string[];
  inputTokens?: number;
  outputTokens?: number;
  schemaValid: boolean;
}

/** Strict JSON Schema for a Zod schema (OpenAI strict mode needs every property required). */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  delete js.$schema;
  return strictify(js);
}

function strictify(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== "object") return node as Record<string, unknown>;
  const n = { ...(node as Record<string, unknown>) };
  // Gemini's OpenAI-compatible strict mode rejects some keywords; Zod re-checks them.
  for (const k of [
    "pattern",
    "format",
    "default",
    "minLength",
    "maxLength",
    "maxItems",
    "minItems",
  ])
    delete n[k];
  if (n.type === "object" && n.properties && typeof n.properties === "object") {
    const props = n.properties as Record<string, unknown>;
    n.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, strictify(v)]));
    n.required = Object.keys(props);
    n.additionalProperties = false;
  }
  if (n.items) n.items = strictify(n.items);
  for (const k of ["anyOf", "oneOf"])
    if (Array.isArray(n[k])) n[k] = (n[k] as unknown[]).map(strictify);
  return n;
}

export function extractJson(text: string): unknown {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(t);
}

export async function structured<T>(
  provider: LlmProvider,
  req: StructuredRequest<T>,
): Promise<StructuredResult<T>> {
  const jsonSchema = jsonSchemaFor(req.schema);
  const fixtures: string[] = [];
  let latency = 0;
  let model: string | undefined;
  let inTok = 0;
  let outTok = 0;
  let lastError = "";
  let user = req.user;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res: LlmResponse = await provider.complete({
      name: req.name,
      system: req.system,
      user,
      jsonSchema,
      temperature: req.temperature,
      maxTokens: req.maxTokens,
      knownNames: req.knownNames,
    });
    latency += res.latencyMs;
    model = res.model;
    if (res.fixture) fixtures.push(res.fixture);
    inTok += res.usage?.inputTokens ?? 0;
    outTok += res.usage?.outputTokens ?? 0;
    const meta = (valid: boolean): LlmMeta => ({
      model,
      latencyMs: latency,
      attempts: attempt,
      fixtures,
      inputTokens: inTok || undefined,
      outputTokens: outTok || undefined,
      schemaValid: valid,
    });
    let parsed: unknown;
    try {
      parsed = extractJson(res.text);
    } catch {
      lastError = "reply was not valid JSON";
    }
    if (parsed !== undefined) {
      const r = req.schema.safeParse(parsed);
      if (r.success) return { ok: true, value: r.data, attempts: attempt, meta: meta(true) };
      lastError = r.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
    }
    if (attempt === 2) return { ok: false, error: lastError, attempts: attempt, meta: meta(false) };
    user = `${req.user}\n\nYour previous reply was invalid: ${lastError}. Reply again with JSON that matches the schema exactly.`;
  }
  throw new Error("unreachable");
}
