import { Prisma, type PrismaClient } from "@prisma/client";

export interface StoredEvent {
  eventId: string;
  eventType: string;
  resourceId?: string;
  raw: unknown;
}

export interface WebhookStore {
  /** Insert a verified event. Returns false if this event id was already stored. */
  insertIfNew(e: StoredEvent): Promise<boolean>;
  markProcessed(eventId: string, dealId?: string): Promise<void>;
  recordAttempt(eventId: string): Promise<void>;
}

export class PrismaWebhookStore implements WebhookStore {
  constructor(private readonly db: PrismaClient) {}

  async insertIfNew(e: StoredEvent): Promise<boolean> {
    try {
      await this.db.webhookEvent.create({
        data: {
          eventId: e.eventId,
          eventType: e.eventType,
          resourceId: e.resourceId ?? null,
          raw: e.raw as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (err) {
      // Unique violation on the primary key: a duplicate delivery.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
      throw err;
    }
  }

  async markProcessed(eventId: string, dealId?: string): Promise<void> {
    await this.db.webhookEvent.update({
      where: { eventId },
      data: { processedAt: new Date(), ...(dealId ? { dealId } : {}) },
    });
  }

  async recordAttempt(eventId: string): Promise<void> {
    await this.db.webhookEvent.update({ where: { eventId }, data: { attempts: { increment: 1 } } });
  }
}
