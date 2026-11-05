import { beforeEach, describe, expect, it } from "vitest";
import { payloadHash } from "../lib/canonical.js";
import { createDeal, dbAvailable, resetDb, seedParties, testDb } from "../test/db.js";
import { DealEventBus, type PublishedDealEvent } from "./bus.js";
import { DealExecutor, DealNotFoundError } from "./executor.js";
import { TransitionError } from "./state-machine.js";

describe.skipIf(!dbAvailable())("DealExecutor (Postgres)", () => {
  const db = testDb();
  let bus: DealEventBus;
  let exec: DealExecutor;
  let parties: Awaited<ReturnType<typeof seedParties>>;

  beforeEach(async () => {
    await resetDb(db);
    bus = new DealEventBus();
    exec = new DealExecutor(db, bus);
    parties = await seedParties(db);
  });

  const newDeal = (state: "DRAFT" | "GUARDED" = "DRAFT") =>
    createDeal(db, { buyerId: parties.buyer.id, sellerId: parties.seller.id, state });

  it("writes the state, a DealEvent and an AuditLog row together, then publishes", async () => {
    const deal = await newDeal();
    const seen: PublishedDealEvent[] = [];
    bus.subscribe(deal.id, (e) => seen.push(e));

    const updated = await exec.apply(
      deal.id,
      { type: "contract.created" },
      { actor: "AGENT", payload: { contractId: "c1" } },
    );

    expect(updated.state).toBe("CONTRACTED");
    const events = await db.dealEvent.findMany({ where: { dealId: deal.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "contract.created",
      fromState: "DRAFT",
      toState: "CONTRACTED",
      actor: "AGENT",
      payload: { contractId: "c1" },
    });
    const audit = await db.auditLog.findMany({ where: { dealId: deal.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "contract.created", actor: "AGENT" });
    expect(audit[0]!.before).toMatchObject({ state: "DRAFT", amount: "100.00" });
    expect(audit[0]!.after).toMatchObject({ state: "CONTRACTED" });
    expect(audit[0]!.payloadHash).toBe(
      payloadHash({
        type: "contract.created",
        payload: { contractId: "c1" },
        from: "DRAFT",
        to: "CONTRACTED",
      }),
    );
    expect(seen.map((e) => e.id)).toEqual([events[0]!.id]);
  });

  it("a rejected transition writes nothing and publishes nothing", async () => {
    const deal = await newDeal();
    const seen: PublishedDealEvent[] = [];
    bus.subscribe(deal.id, (e) => seen.push(e));

    await expect(
      exec.apply(deal.id, { type: "buyer.approve" }, { actor: "HUMAN" }),
    ).rejects.toThrow(TransitionError);

    expect((await db.deal.findUniqueOrThrow({ where: { id: deal.id } })).state).toBe("DRAFT");
    expect(await db.dealEvent.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
    expect(seen).toEqual([]);
  });

  it("rolls back every write in the callback when a later step throws", async () => {
    const deal = await newDeal();
    const seen: PublishedDealEvent[] = [];
    bus.subscribe(deal.id, (e) => seen.push(e));

    await expect(
      exec.withDeal(deal.id, async (d) => {
        await d.apply({ type: "contract.created" }, { actor: "AGENT" });
        await d.append("note", { actor: "SYSTEM" });
        throw new Error("boom after writes");
      }),
    ).rejects.toThrow("boom after writes");

    expect((await db.deal.findUniqueOrThrow({ where: { id: deal.id } })).state).toBe("DRAFT");
    expect(await db.dealEvent.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
    expect(seen).toEqual([]);
  });

  it("publishes only after commit, in write order", async () => {
    const deal = await newDeal();
    const order: string[] = [];
    bus.subscribe(deal.id, (e) => order.push(`published:${e.type}`));

    await exec.withDeal(deal.id, async (d) => {
      await d.apply({ type: "contract.created" }, { actor: "AGENT" });
      await d.append("paypal.confirmed", { actor: "PAYPAL" });
      order.push("callback-done");
    });

    expect(order).toEqual([
      "callback-done",
      "published:contract.created",
      "published:paypal.confirmed",
    ]);
  });

  it("unknown deal -> DealNotFoundError", async () => {
    await expect(exec.withDeal("nope", async () => 1)).rejects.toBeInstanceOf(DealNotFoundError);
  });

  it("guards read the DB under the lock (release needs a persisted Decision)", async () => {
    const deal = await createDeal(db, {
      buyerId: parties.buyer.id,
      sellerId: parties.seller.id,
      state: "NEEDS_REVIEW",
      paypalAuthId: "AUTH1",
      authExpiresAt: new Date(Date.now() + 86_400_000),
    });
    await expect(
      exec.apply(deal.id, { type: "human.approve" }, { actor: "HUMAN" }),
    ).rejects.toThrow(/Decision/);
    await db.decision.create({
      data: {
        dealId: deal.id,
        deliverableId: "d1",
        outcome: "PASS",
        score: 100,
        perCriterion: [],
        reasoning: "ok",
        payoutPercent: 100,
      },
    });
    expect((await exec.apply(deal.id, { type: "human.approve" }, { actor: "HUMAN" })).state).toBe(
      "RELEASING",
    );
  });

  it("concurrent conflicting transitions: exactly one wins, the other is rejected", async () => {
    const deal = await newDeal("GUARDED");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    // A holds the lock while B tries to cancel the same deal.
    const a = exec.withDeal(deal.id, async (d) => {
      await d.apply({ type: "paypal.order.created", policyAllowed: true }, { actor: "SYSTEM" });
      await gate;
    });
    await new Promise((r) => setTimeout(r, 100));
    const b = exec.apply(deal.id, { type: "buyer.cancel" }, { actor: "HUMAN" });
    await new Promise((r) => setTimeout(r, 200));
    release();

    const [ra, rb] = await Promise.allSettled([a, b]);
    expect(ra.status).toBe("fulfilled");
    // B waited for A's lock, then saw FUNDING and cancel from FUNDING is allowed.
    expect(rb.status).toBe("fulfilled");
    const events = await db.dealEvent.findMany({
      where: { dealId: deal.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => `${e.fromState}->${e.toState}`)).toEqual([
      "GUARDED->FUNDING",
      "FUNDING->CANCELLED",
    ]);
  });

  it("many concurrent identical transitions: exactly one applies", async () => {
    const deal = await newDeal();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        exec.apply(deal.id, { type: "contract.created" }, { actor: "AGENT" }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof TransitionError,
    );
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    expect(await db.dealEvent.count({ where: { dealId: deal.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { dealId: deal.id } })).toBe(1);
  });
});
