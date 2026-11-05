import type { PayPalLogger } from "../paypal/http.js";
import type { WebhookStore } from "./store.js";

export interface WebhookEventEnvelope {
  id: string;
  event_type: string;
  resource_type?: string;
  resource?: { id?: string; custom_id?: string; [k: string]: unknown };
  create_time?: string;
}

/**
 * Processes a stored, verified event after the 200 has been sent.
 *
 * Phase 1: logs the event and marks it processed. Phase 2 (Task 11) maps it to
 * a deal, appends a "PayPal confirmed" DealEvent and wakes the reconciler.
 * Webhooks never move deal state directly and never trigger money writes.
 */
export class WebhookProcessor {
  constructor(
    private readonly store: WebhookStore,
    private readonly log: Pick<PayPalLogger, "info" | "error">,
  ) {}

  async process(event: WebhookEventEnvelope): Promise<void> {
    try {
      await this.store.recordAttempt(event.id);
      this.log.info(
        {
          event_id: event.id,
          event_type: event.event_type,
          resource_id: event.resource?.id,
          custom_id: event.resource?.custom_id,
        },
        "paypal webhook processed",
      );
      await this.store.markProcessed(event.id);
    } catch (err) {
      // Left unprocessed; the sweeper retries it (Task 11).
      this.log.error(
        { event_id: event.id, err: (err as Error).message },
        "paypal webhook processing failed",
      );
    }
  }
}
