import { createHash } from "node:crypto";
import type { PayPalHttp } from "../paypal/http.js";

/**
 * PayPal webhook signature verification (invariant 3, references/webhooks.md).
 *
 * The five PAYPAL-* transmission headers, our webhook_id, and the raw request
 * body are sent to POST /v1/notifications/verify-webhook-signature. The raw
 * bytes are spliced into the request JSON unchanged: re-serializing the event
 * (even whitespace) changes what the signature was computed over.
 *
 * Simulator events (Dashboard or simulate-event) carry a fixed webhook_id and
 * never verify; only real deliveries do.
 */

export const TRANSMISSION_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

export type TransmissionFields = Record<keyof typeof TRANSMISSION_HEADERS, string>;

/** Extract the five transmission headers, or null if any is missing or empty. */
export function transmissionFields(
  headers: Record<string, string | string[] | undefined>,
): TransmissionFields | null {
  const out: Partial<TransmissionFields> = {};
  for (const [field, header] of Object.entries(TRANSMISSION_HEADERS)) {
    const v = headers[header];
    if (typeof v !== "string" || v.trim() === "") return null;
    out[field as keyof TransmissionFields] = v;
  }
  return out as TransmissionFields;
}

/**
 * Build the verify request body with the raw event bytes spliced in.
 * The caller must have checked that `rawBody` is valid JSON.
 */
export function buildVerifyBody(
  fields: TransmissionFields,
  webhookId: string,
  rawBody: string,
): string {
  const head = JSON.stringify({ ...fields, webhook_id: webhookId });
  return `${head.slice(0, -1)},"webhook_event":${rawBody}}`;
}

export interface WebhookVerifier {
  verify(fields: TransmissionFields, rawBody: string): Promise<boolean>;
}

export class PayPalWebhookVerifier implements WebhookVerifier {
  constructor(
    private readonly http: PayPalHttp,
    private readonly webhookId: string,
  ) {}

  async verify(fields: TransmissionFields, rawBody: string): Promise<boolean> {
    const res = await this.http.request<{ verification_status?: string }>({
      method: "POST",
      path: "/v1/notifications/verify-webhook-signature",
      // Stable per delivery so an HTTP retry of this verification reuses the key.
      requestId: createHash("sha256")
        .update(`webhook-verify:${fields.transmission_id}`)
        .digest("hex"),
      rawBody: buildVerifyBody(fields, this.webhookId, rawBody),
    });
    return res.data?.verification_status === "SUCCESS";
  }
}
