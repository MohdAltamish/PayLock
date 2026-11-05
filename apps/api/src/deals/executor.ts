import { toMoney } from "@paylock/schemas";
import type { Prisma, Actor, Deal, PrismaClient } from "@prisma/client";
import { normalize, payloadHash } from "../lib/canonical.js";
import type { DealEventBus, PublishedDealEvent } from "./bus.js";
import { transition, type DealContext, type DealEvent } from "./state-machine.js";

/**
 * Transition executor (Task 8, DESIGN.md section 3 guards).
 *
 * `withDeal` opens a transaction, takes `SELECT ... FOR UPDATE` on the deal
 * row, and hands the callback a LockedDeal. Every state change and timeline
 * entry written through it creates a DealEvent and an AuditLog row in the same
 * transaction. Events are published to the bus only after the commit.
 */

export type Tx = Prisma.TransactionClient;

export interface EventMeta {
  actor: Actor;
  actorId?: string | null;
  /** Extra timeline payload. Must not contain secrets; PII only where the UI needs it. */
  payload?: Record<string, unknown>;
}

export class DealNotFoundError extends Error {
  constructor(public readonly dealId: string) {
    super(`Deal ${dealId} not found`);
    this.name = "DealNotFoundError";
  }
}

export class LockedDeal {
  constructor(
    readonly tx: Tx,
    private current: Deal,
    private readonly outbox: PublishedDealEvent[],
    private readonly now: () => Date,
  ) {}

  get deal(): Deal {
    return this.current;
  }

  /** Guard context computed from the DB under the lock. */
  async context(): Promise<DealContext> {
    const d = this.current;
    const decisions = await this.tx.decision.count({ where: { dealId: d.id } });
    return {
      requiresHumanRelease: d.requiresHumanRelease,
      blockReason: d.blockReason,
      hasPaypalAuth: !!d.paypalAuthId,
      authValid: !!d.authExpiresAt && d.authExpiresAt.getTime() > this.now().getTime(),
      hasDecision: decisions > 0,
    };
  }

  /**
   * Apply a state machine event. Throws TransitionError (rolling back the whole
   * transaction) if the machine rejects it. `set` adds columns to the same update.
   */
  async apply(
    event: DealEvent,
    meta: EventMeta,
    set: Prisma.DealUncheckedUpdateInput = {},
  ): Promise<Deal> {
    const before = this.current;
    const result = transition(before.state, event, await this.context());
    const updated = await this.tx.deal.update({
      where: { id: before.id },
      data: { ...set, ...result.set, state: result.to },
    });
    const { type: _t, ...fields } = event;
    await this.write(event.type, before, updated, meta, { ...fields, ...meta.payload });
    this.current = updated;
    return updated;
  }

  /** Timeline entry without a state change (e.g. "PayPal confirmed", "Confirming with PayPal"). */
  async append(type: string, meta: EventMeta): Promise<void> {
    await this.write(type, this.current, this.current, meta, meta.payload ?? {});
  }

  /** Update deal columns that are not state (e.g. paypalOrderId) with an audit row. */
  async update(data: Prisma.DealUncheckedUpdateInput, meta: EventMeta, action: string) {
    const before = this.current;
    const updated = await this.tx.deal.update({ where: { id: before.id }, data });
    await this.tx.auditLog.create({
      data: {
        dealId: before.id,
        actor: meta.actor,
        actorId: meta.actorId ?? null,
        action,
        before: snapshot(before),
        after: snapshot(updated),
        payloadHash: payloadHash({ action, data, payload: meta.payload ?? {} }),
      },
    });
    this.current = updated;
    return updated;
  }

  private async write(
    type: string,
    before: Deal,
    after: Deal,
    meta: EventMeta,
    payload: Record<string, unknown>,
  ) {
    const json = normalize(payload) as Prisma.InputJsonValue;
    const row = await this.tx.dealEvent.create({
      data: {
        dealId: before.id,
        type,
        fromState: before.state,
        toState: after.state,
        actor: meta.actor,
        payload: json,
      },
    });
    await this.tx.auditLog.create({
      data: {
        dealId: before.id,
        actor: meta.actor,
        actorId: meta.actorId ?? null,
        action: type,
        before: snapshot(before),
        after: snapshot(after),
        payloadHash: payloadHash({ type, payload: json, from: before.state, to: after.state }),
      },
    });
    this.outbox.push(row);
  }
}

/** Fields worth auditing; no PII (payout email is omitted). */
function snapshot(d: Deal): Prisma.InputJsonValue {
  return normalize({
    state: d.state,
    amount: toMoney(d.amount.toString()),
    paypalOrderId: d.paypalOrderId,
    paypalAuthId: d.paypalAuthId,
    authExpiresAt: d.authExpiresAt,
    requiresHumanRelease: d.requiresHumanRelease,
    blockReason: d.blockReason,
  }) as Prisma.InputJsonValue;
}

export interface ExecutorOptions {
  now?: () => Date;
  /** Interactive transaction timeout; PayPal calls never run inside one. */
  timeoutMs?: number;
}

export class DealExecutor {
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(
    readonly db: PrismaClient,
    readonly bus: DealEventBus,
    opts: ExecutorOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /**
   * Run `fn` in a transaction holding a row lock on the deal. Events written
   * through the LockedDeal are published after a successful commit only.
   */
  async withDeal<T>(dealId: string, fn: (d: LockedDeal) => Promise<T>): Promise<T> {
    const outbox: PublishedDealEvent[] = [];
    const result = await this.db.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Deal" WHERE id = ${dealId} FOR UPDATE`;
        if (locked.length === 0) throw new DealNotFoundError(dealId);
        const deal = await tx.deal.findUniqueOrThrow({ where: { id: dealId } });
        return fn(new LockedDeal(tx, deal, outbox, this.now));
      },
      { maxWait: 5_000, timeout: this.timeoutMs },
    );
    for (const e of outbox) this.bus.publish(e);
    return result;
  }

  /** Convenience: lock, apply one event, commit, publish. */
  async apply(
    dealId: string,
    event: DealEvent,
    meta: EventMeta,
    set?: Prisma.DealUncheckedUpdateInput,
  ): Promise<Deal> {
    return this.withDeal(dealId, (d) => d.apply(event, meta, set));
  }

  clock(): Date {
    return this.now();
  }
}
