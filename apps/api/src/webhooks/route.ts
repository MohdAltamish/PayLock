import type { FastifyInstance } from "fastify";
import { problemBody } from "../lib/problem.js";
import type { WebhookEventEnvelope, WebhookProcessor } from "./processor.js";
import type { WebhookStore } from "./store.js";
import { transmissionFields, type WebhookVerifier } from "./verify.js";

export interface WebhookRouteDeps {
  /** Undefined when PAYPAL_WEBHOOK_ID is not configured. */
  verifier?: WebhookVerifier;
  store: WebhookStore;
  processor: Pick<WebhookProcessor, "process">;
  /** Defaults to setImmediate; tests run it inline. */
  defer?: (fn: () => void) => void;
}

/**
 * POST /webhooks/paypal (invariant 3).
 *
 * 1. Read the raw body as a Buffer (this plugin's own content parser, so the
 *    bytes are never re-serialized).
 * 2. Verify the signature with PayPal. Failure or missing headers: 400, logged,
 *    nothing stored or processed.
 * 3. Insert by event id. Duplicate: 200, nothing else.
 * 4. Reply 200, then process asynchronously.
 */
export async function webhookRoutes(app: FastifyInstance, deps: WebhookRouteDeps) {
  const defer = deps.defer ?? ((fn) => setImmediate(fn));

  // Scoped to this plugin: JSON stays a raw Buffer only for the webhook route.
  app.addContentTypeParser(
    ["application/json", "application/*+json"],
    { parseAs: "buffer", bodyLimit: 1_048_576 },
    (_req, body, done) => done(null, body),
  );

  app.post("/webhooks/paypal", async (req, reply) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const fields = transmissionFields(req.headers);
    const transmissionId = fields?.transmission_id;

    if (!deps.verifier) {
      req.log.error("PAYPAL_WEBHOOK_ID is not configured; refusing webhook");
      return reply
        .status(503)
        .type("application/problem+json")
        .send(
          problemBody(req, 503, "webhook-not-configured", "Webhook verification is not configured"),
        );
    }

    let event: WebhookEventEnvelope;
    try {
      event = JSON.parse(raw) as WebhookEventEnvelope;
    } catch {
      req.log.warn({ transmission_id: transmissionId }, "webhook rejected: body is not JSON");
      return reject(400, "Body is not valid JSON");
    }
    if (!fields) {
      req.log.warn("webhook rejected: missing PayPal transmission headers");
      return reject(400, "Missing PayPal transmission headers");
    }
    if (typeof event?.id !== "string" || typeof event?.event_type !== "string") {
      req.log.warn(
        { transmission_id: transmissionId },
        "webhook rejected: missing id or event_type",
      );
      return reject(400, "Missing event id or event_type");
    }

    let verified = false;
    try {
      verified = await deps.verifier.verify(fields, raw);
    } catch (err) {
      // PayPal unreachable: tell PayPal to retry later; never process unverified.
      req.log.error(
        { transmission_id: transmissionId, err: (err as Error).message },
        "webhook verification call failed",
      );
      return reply
        .status(503)
        .type("application/problem+json")
        .send(
          problemBody(
            req,
            503,
            "webhook-verification-unavailable",
            "Could not verify webhook signature",
          ),
        );
    }
    if (!verified) {
      req.log.warn(
        { transmission_id: transmissionId, event_id: event.id, event_type: event.event_type },
        "webhook rejected: signature verification failed",
      );
      return reject(400, "Signature verification failed");
    }

    const isNew = await deps.store.insertIfNew({
      eventId: event.id,
      eventType: event.event_type,
      resourceId: typeof event.resource?.id === "string" ? event.resource.id : undefined,
      raw: event,
    });
    if (!isNew) {
      req.log.info(
        { event_id: event.id, event_type: event.event_type },
        "webhook duplicate ignored",
      );
      return reply.status(200).send({ received: true, duplicate: true });
    }

    req.log.info(
      { event_id: event.id, event_type: event.event_type, transmission_id: transmissionId },
      "webhook verified",
    );
    defer(() => void deps.processor.process(event));
    return reply.status(200).send({ received: true });

    function reject(status: number, detail: string) {
      return reply
        .status(status)
        .type("application/problem+json")
        .send(problemBody(req, status, "webhook-rejected", "Webhook rejected", detail));
    }
  });
}
