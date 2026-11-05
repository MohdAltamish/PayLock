import type { PayPalAdapter } from "./adapter.js";
import { PayPalError } from "./errors.js";

/** The adapter surface used by funding, settlement and reconciliation. */
export type PayPalPort = Pick<
  PayPalAdapter,
  | "createOrder"
  | "getOrder"
  | "authorizeOrder"
  | "getAuthorization"
  | "captureAuthorization"
  | "getCapture"
  | "voidAuthorization"
  | "createPayout"
  | "getPayoutBatch"
  | "refundCapture"
>;

/**
 * True when the outcome of a PayPal write is unknown (network error, timeout,
 * 5xx, 429 or a request still in progress after retries). The PaymentRecord
 * stays PENDING and is resumed later with the same PayPal-Request-Id.
 * Anything else (validation errors, declines, approval or freeze refusals) is
 * definitive: the attempt failed and a new attempt needs a new key.
 */
export function isOutcomeUnknown(err: unknown): boolean {
  if (!(err instanceof PayPalError)) return false;
  if (err.status === 0 || err.status >= 500 || err.status === 429) return true;
  return err.hasIssue("PREVIOUS_REQUEST_IN_PROGRESS");
}

/** Safe-to-store error summary (no bodies, no PII). */
export function errorSummary(err: unknown): Record<string, unknown> {
  if (err instanceof PayPalError) return { ...err.toLog(), message: err.message.slice(0, 300) };
  if (err instanceof Error) return { name: err.name, message: err.message.slice(0, 300) };
  return { name: "Unknown", message: String(err).slice(0, 300) };
}
