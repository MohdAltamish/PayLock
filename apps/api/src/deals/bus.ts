import { EventEmitter } from "node:events";
import type { Actor, DealState } from "@prisma/client";

/** A committed DealEvent row, as published to SSE subscribers. */
export interface PublishedDealEvent {
  id: string;
  dealId: string;
  type: string;
  fromState: DealState | null;
  toState: DealState | null;
  actor: Actor;
  payload: unknown;
  createdAt: Date;
}

/**
 * In-process pub/sub for deal events. The executor publishes only after the
 * transaction commits, so subscribers never see a rolled-back event.
 */
export class DealEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(e: PublishedDealEvent): void {
    this.emitter.emit(`deal:${e.dealId}`, e);
    this.emitter.emit("any", e);
  }

  subscribe(dealId: string, fn: (e: PublishedDealEvent) => void): () => void {
    const ch = `deal:${dealId}`;
    this.emitter.on(ch, fn);
    return () => this.emitter.off(ch, fn);
  }

  subscribeAll(fn: (e: PublishedDealEvent) => void): () => void {
    this.emitter.on("any", fn);
    return () => this.emitter.off("any", fn);
  }
}
