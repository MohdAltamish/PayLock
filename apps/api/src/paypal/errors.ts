/**
 * PayPal error model. Every failed PayPal call becomes a PayPalError carrying
 * PayPal's `name`, the first `details[].issue`, and the `debug_id` (required
 * for PayPal support; always logged). Response bodies are never logged whole.
 */

export interface PayPalErrorDetail {
  field?: string;
  issue?: string;
  description?: string;
  location?: string;
}

export class PayPalError extends Error {
  constructor(
    /** HTTP status, or 0 for network failures and timeouts. */
    public readonly status: number,
    /** PayPal `name` (e.g. UNPROCESSABLE_ENTITY, RESOURCE_CONFLICT) or OAuth `error`. */
    public readonly paypalName: string,
    message: string,
    public readonly debugId: string | undefined,
    public readonly details: PayPalErrorDetail[] = [],
    /** Total tries made, including the first. */
    public readonly attempts = 1,
  ) {
    super(message);
    this.name = "PayPalError";
  }

  /** The most specific code: first details[].issue, else name. */
  get issue(): string {
    return this.details.find((d) => d.issue)?.issue ?? this.paypalName;
  }

  hasIssue(issue: string): boolean {
    return this.paypalName === issue || this.details.some((d) => d.issue === issue);
  }

  /** Safe to log: no request or response bodies. */
  toLog() {
    return {
      status: this.status,
      name: this.paypalName,
      issue: this.issue,
      debug_id: this.debugId,
      attempts: this.attempts,
    };
  }
}

/** Parse a PayPal error body (REST or OAuth shape). Unknown shapes still produce a usable error. */
export function parsePayPalError(
  status: number,
  body: unknown,
  headerDebugId: string | null | undefined,
  attempts = 1,
): PayPalError {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const name =
    (typeof b.name === "string" && b.name) ||
    (typeof b.error === "string" && b.error) ||
    `HTTP_${status}`;
  const message =
    (typeof b.message === "string" && b.message) ||
    (typeof b.error_description === "string" && b.error_description) ||
    `PayPal request failed with HTTP ${status}`;
  const debugId = (typeof b.debug_id === "string" && b.debug_id) || headerDebugId || undefined;
  const details = Array.isArray(b.details)
    ? (b.details as unknown[]).filter((d): d is PayPalErrorDetail => !!d && typeof d === "object")
    : [];
  return new PayPalError(status, name, message, debugId, details, attempts);
}

/** Errors that must never be retried automatically (explain-error.md). */
export const NON_RETRYABLE_ISSUES = [
  "INSTRUMENT_DECLINED",
  "TRANSACTION_REFUSED",
  "PAYPAL_REQUEST_ID_PREVIOUSLY_USED",
] as const;
