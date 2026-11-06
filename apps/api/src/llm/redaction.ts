import type { LlmProvider, LlmRequest, LlmResponse } from "./types.js";

/**
 * PII redaction (invariant 7, ADR-007, SECURITY_PRIVACY section 3).
 *
 * Replaces emails, phone numbers, street addresses, known person names,
 * PayPal resource ids and URLs with query strings by stable per-request
 * tokens (`<EMAIL_1>`). The map lives in memory for one request only and is
 * used to restore tokens in the model's reply for display.
 */
type Kind = "EMAIL" | "URL" | "PAYPAL_ID" | "PHONE" | "ADDRESS" | "NAME";

const PATTERNS: Array<[Kind, RegExp]> = [
  ["EMAIL", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ["URL", /https?:\/\/[^\s"'<>]+\?[^\s"'<>]+/g],
  // PayPal order/authorization/capture/batch ids: 13-20 upper-case letters and digits, both present.
  ["PAYPAL_ID", /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{13,20}\b/g],
  ["PHONE", /(?<![\w<])\+?\d[\d\s().-]{7,}\d(?![\w>])/g],
  [
    "ADDRESS",
    /\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Boulevard|Blvd|Drive|Dr|Court|Ct|Way)\b\.?/g,
  ],
];

export class Redactor {
  private readonly toToken = new Map<string, string>();
  private readonly toValue = new Map<string, string>();
  private readonly counts: Partial<Record<Kind, number>> = {};

  constructor(private readonly knownNames: string[] = []) {}

  redact(text: string): string {
    let out = text;
    for (const [kind, re] of PATTERNS) out = out.replace(re, (m) => this.token(kind, m));
    for (const name of this.knownNames.filter((n) => n.trim().length >= 3)) {
      const re = new RegExp(`\\b${escapeRe(name.trim())}\\b`, "gi");
      out = out.replace(re, (m) => this.token("NAME", m));
    }
    return out;
  }

  restore(text: string): string {
    return text.replace(
      /<(EMAIL|URL|PAYPAL_ID|PHONE|ADDRESS|NAME)_\d+>/g,
      (t) => this.toValue.get(t) ?? t,
    );
  }

  /** Counts per kind; safe to log (no content). */
  stats(): Partial<Record<Kind, number>> {
    return { ...this.counts };
  }

  private token(kind: Kind, value: string): string {
    const key = `${kind}:${value.toLowerCase()}`;
    const existing = this.toToken.get(key);
    if (existing) return existing;
    const n = (this.counts[kind] = (this.counts[kind] ?? 0) + 1);
    const t = `<${kind}_${n}>`;
    this.toToken.set(key, t);
    this.toValue.set(t, value);
    return t;
  }
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wraps every provider so no agent can skip redaction. The request's
 * `knownNames` are user display names that must not reach the model.
 */
export class RedactingProvider implements LlmProvider {
  readonly kind: string;
  constructor(
    private readonly inner: LlmProvider,
    private readonly onStats?: (name: string, stats: Record<string, number>) => void,
  ) {
    this.kind = `redacted(${inner.kind})`;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const r = new Redactor(req.knownNames ?? []);
    const redacted: LlmRequest = {
      name: req.name,
      jsonSchema: req.jsonSchema,
      temperature: req.temperature,
      maxTokens: req.maxTokens,
      system: r.redact(req.system),
      user: r.redact(req.user),
    };
    this.onStats?.(req.name, r.stats() as Record<string, number>);
    const res = await this.inner.complete(redacted);
    return { ...res, text: r.restore(res.text) };
  }
}
