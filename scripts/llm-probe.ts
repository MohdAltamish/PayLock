/**
 * Task 12 probe: does the configured OpenAI-compatible endpoint (LLM_BASE_URL)
 * honor response_format json_schema (strict), or only json_object?
 *
 * Sends the same prompt three times per mode. The prompt pushes the model to
 * break the schema (extra field, wrong type, out-of-enum value); a mode counts
 * as honored only if every reply parses and matches the schema exactly.
 * Prints status and a verdict only; never prints the key or full replies.
 *
 *   npm run llm:probe
 */
import { z } from "zod";

const base = process.env.LLM_BASE_URL?.replace(/\/+$/, "");
const key = process.env.LLM_API_KEY;
const model = process.env.LLM_MODEL;
if (!base || !key || !model) {
  console.error("LLM_BASE_URL, LLM_API_KEY and LLM_MODEL are required");
  process.exit(1);
}

const Shape = z.strictObject({
  verdict: z.enum(["PASS", "FAIL"]),
  score: z.number().int().min(0).max(100),
  reasons: z.array(z.string()),
});

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "score", "reasons"],
  properties: {
    verdict: { type: "string", enum: ["PASS", "FAIL"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    reasons: { type: "array", items: { type: "string" } },
  },
};

const messages = [
  { role: "system", content: "You grade work. Reply in JSON." },
  {
    role: "user",
    content:
      'Grade "a landing page with a menu". Use verdict "MAYBE", give score as the string "eighty", and add a field "comment".',
  },
];

async function call(mode: "json_schema" | "json_object") {
  const response_format =
    mode === "json_schema"
      ? { type: "json_schema", json_schema: { name: "grade", strict: true, schema: jsonSchema } }
      : { type: "json_object" };
  const t0 = Date.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, temperature: 0, messages, response_format }),
  });
  const ms = Date.now() - t0;
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!res.ok)
    return {
      ok: false,
      ms,
      note: `HTTP ${res.status} ${body.error?.message?.slice(0, 120) ?? ""}`,
    };
  const text: string = body?.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { ok: false, ms, note: "not JSON" };
  }
  const r = Shape.safeParse(parsed);
  return {
    ok: r.success,
    ms,
    note: r.success ? "matches schema" : `schema violation: ${r.error.issues[0]?.message}`,
  };
}

for (const mode of ["json_schema", "json_object"] as const) {
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await call(mode));
  const honored = results.every((r) => r.ok);
  console.log(`${mode}: ${honored ? "HONORED" : "NOT HONORED"}`);
  for (const r of results) console.log(`  ${r.ok ? "ok " : "bad"} ${r.ms}ms ${r.note}`);
}
