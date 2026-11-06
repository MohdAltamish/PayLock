import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAiProvider } from "./openai.js";
import { RedactingProvider, Redactor } from "./redaction.js";
import { RecordingProvider, ReplayMissError, ReplayProvider } from "./replay.js";
import { jsonSchemaFor, structured } from "./structured.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types.js";

class Spy implements LlmProvider {
  readonly kind = "spy";
  seen: LlmRequest[] = [];
  constructor(private readonly replies: string[]) {}
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.seen.push(req);
    return { text: this.replies.shift() ?? "", model: "spy-1", latencyMs: 1 };
  }
}

const Out = z.object({ verdict: z.enum(["PASS", "FAIL"]), note: z.string() });
const req = (over: Partial<Parameters<typeof structured>[1]> = {}) => ({
  name: "probe",
  schema: Out,
  system: "sys",
  user: "grade it",
  temperature: 0,
  maxTokens: 100,
  ...over,
});

describe("structured()", () => {
  it("returns the validated value on the first valid reply", async () => {
    const spy = new Spy(['{"verdict":"PASS","note":"ok"}']);
    const r = await structured(spy, req());
    expect(r).toMatchObject({ ok: true, value: { verdict: "PASS", note: "ok" }, attempts: 1 });
    expect(spy.seen[0]!.jsonSchema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("retries once with the validation error, then succeeds", async () => {
    const spy = new Spy(['{"verdict":"MAYBE","note":"?"}', '{"verdict":"FAIL","note":"no"}']);
    const r = await structured(spy, req());
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(spy.seen[1]!.user).toMatch(/previous reply was invalid: verdict/);
  });

  it("fails safe after two invalid replies (never parses free text)", async () => {
    const spy = new Spy(["The verdict is PASS.", '{"verdict":"PASS"}']);
    const r = await structured(spy, req());
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(2);
    expect(spy.seen).toHaveLength(2);
  });

  it("accepts fenced JSON", async () => {
    const r = await structured(new Spy(['```json\n{"verdict":"PASS","note":"x"}\n```']), req());
    expect(r.ok).toBe(true);
  });

  it("jsonSchemaFor marks every property required and closes objects", () => {
    const js = jsonSchemaFor(
      z.object({
        a: z.string(),
        b: z.number().optional(),
        c: z.array(z.object({ d: z.boolean() })),
      }),
    );
    expect(js.required).toEqual(["a", "b", "c"]);
    expect((js.properties as any).c.items.additionalProperties).toBe(false);
  });
});

describe("redaction middleware (invariant 7)", () => {
  it("the provider never sees emails, phones, PayPal ids, query URLs or known names", async () => {
    const spy = new Spy(['{"verdict":"PASS","note":"contact <EMAIL_1> about <NAME_1>"}']);
    const provider = new RedactingProvider(spy);
    const text =
      "Alice Johnson here, email alice@example.com, call +1 (415) 555-0100, order 5O190127TN364715T, " +
      "see https://site.test/p?token=abc, ship to 12 Market Street.";
    const r = await structured(
      provider,
      req({ user: text, system: "Reply about alice@example.com", knownNames: ["Alice Johnson"] }),
    );
    const seen = spy.seen[0]!;
    for (const secret of [
      "alice@example.com",
      "555-0100",
      "5O190127TN364715T",
      "token=abc",
      "Alice Johnson",
      "12 Market Street",
    ]) {
      expect(seen.user).not.toContain(secret);
      expect(seen.system).not.toContain(secret);
    }
    expect(seen.user).toContain("<EMAIL_1>");
    expect(seen.system).toContain("<EMAIL_1>"); // stable token per request
    expect(seen.knownNames).toBeUndefined();
    // Restored for display.
    expect(r.ok && (r.value as { note: string }).note).toBe(
      "contact alice@example.com about Alice Johnson",
    );
  });

  it("keeps money and ordinary numbers", () => {
    const r = new Redactor();
    expect(r.redact("Budget $300.00 by Friday, 3 pages, 375px and 1280px")).toBe(
      "Budget $300.00 by Friday, 3 pages, 375px and 1280px",
    );
  });

  it("reports counts only", () => {
    const r = new Redactor();
    r.redact("a@b.co and c@d.co and a@b.co");
    expect(r.stats()).toEqual({ EMAIL: 2 });
  });
});

describe("replay provider", () => {
  it("records a live reply and replays it identically; a miss is an error", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "replay-"));
    const live = new Spy(['{"verdict":"PASS","note":"recorded"}']);
    const rec = await structured(
      new RedactingProvider(new RecordingProvider(live, dir)),
      req({ user: "x@y.co asks" }),
    );
    expect(rec.ok).toBe(true);
    const rep = await structured(
      new RedactingProvider(new ReplayProvider(dir)),
      req({ user: "x@y.co asks" }),
    );
    expect(rep).toMatchObject({ ok: true, value: { verdict: "PASS", note: "recorded" } });
    expect(rep.meta.fixtures).toHaveLength(1);
    await expect(
      new ReplayProvider(dir).complete({ ...req(), user: "other", jsonSchema: {} } as any),
    ).rejects.toBeInstanceOf(ReplayMissError);
  });
});

describe("providers", () => {
  const ok = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

  it("OpenAI-compatible: strict json_schema response_format, bearer key, base URL", async () => {
    let url = "";
    let sent: any;
    const p = new OpenAiProvider({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: "k",
      model: "gemini-x",
      jsonMode: "json_schema",
      timeoutMs: 1000,
      fetch: (async (u: string, init: RequestInit) => {
        url = u;
        sent = { ...init, body: JSON.parse(init.body as string) };
        return ok({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 3 } })();
      }) as any,
    });
    const r = await p.complete({
      name: "n",
      system: "s",
      user: "u",
      jsonSchema: { type: "object" },
      temperature: 0,
      maxTokens: 9,
    });
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(sent.headers.authorization).toBe("Bearer k");
    expect(sent.body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "n", strict: true, schema: { type: "object" } },
    });
    expect(r.usage?.inputTokens).toBe(3);
  });

  it("OpenAI-compatible: json_object mode puts the schema in the prompt", async () => {
    let sent: any;
    const p = new OpenAiProvider({
      baseUrl: "https://x.test/v1",
      apiKey: "k",
      model: "m",
      jsonMode: "json_object",
      timeoutMs: 1000,
      fetch: (async (_u: string, init: RequestInit) => {
        sent = JSON.parse(init.body as string);
        return ok({ choices: [{ message: { content: "{}" } }] })();
      }) as any,
    });
    await p.complete({
      name: "n",
      system: "s",
      user: "u",
      jsonSchema: { type: "object" },
      temperature: 0,
      maxTokens: 9,
    });
    expect(sent.response_format).toEqual({ type: "json_object" });
    expect(sent.messages[1].content).toContain('{"type":"object"}');
  });

  it("OpenAI-compatible: retries 429/5xx, not 4xx", async () => {
    let calls = 0;
    const mk = (status: number) =>
      new OpenAiProvider({
        baseUrl: "https://x.test/v1",
        apiKey: "k",
        model: "m",
        jsonMode: "json_schema",
        timeoutMs: 1000,
        sleep: async () => {},
        fetch: (async () => {
          calls++;
          return new Response("{}", { status });
        }) as any,
      });
    calls = 0;
    await expect(
      mk(503).complete({
        name: "n",
        system: "",
        user: "",
        jsonSchema: {},
        temperature: 0,
        maxTokens: 1,
      }),
    ).rejects.toThrow(/503/);
    expect(calls).toBe(5);
    calls = 0;
    await expect(
      mk(400).complete({
        name: "n",
        system: "",
        user: "",
        jsonSchema: {},
        temperature: 0,
        maxTokens: 1,
      }),
    ).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });

  it("Anthropic: forced tool call returns the tool input as JSON", async () => {
    let sent: any;
    const p = new AnthropicProvider({
      apiKey: "k",
      model: "claude-x",
      timeoutMs: 1000,
      fetch: (async (_u: string, init: RequestInit) => {
        sent = JSON.parse(init.body as string);
        return ok({ content: [{ type: "tool_use", name: "n", input: { verdict: "PASS" } }] })();
      }) as any,
    });
    const r = await p.complete({
      name: "n",
      system: "s",
      user: "u",
      jsonSchema: { type: "object" },
      temperature: 0,
      maxTokens: 9,
    });
    expect(sent.tool_choice).toEqual({ type: "tool", name: "n" });
    expect(JSON.parse(r.text)).toEqual({ verdict: "PASS" });
  });
});
