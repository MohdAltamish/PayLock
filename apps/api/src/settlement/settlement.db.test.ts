import { beforeEach, describe, expect, it } from "vitest";
import { dbAvailable, resetDb, testDb } from "../test/db.js";
import { dealTo, harness, type Harness } from "../test/harness.js";

describe.skipIf(!dbAvailable())("settlement (mocked PayPal)", () => {
  const db = testDb();
  let h: Harness;
  beforeEach(async () => {
    await resetDb(db);
    h = await harness(db);
  });

  const deal = (id: string) => db.deal.findUniqueOrThrow({ where: { id } });
  const records = (id: string, kind: "CAPTURE" | "PAYOUT" | "VOID" | "REFUND") =>
    db.paymentRecord.findMany({ where: { dealId: id, kind }, orderBy: { attempt: "asc" } });
  const deliver = async (id: string, content: string) => {
    const r = await h.as("seller", "POST", `/deals/${id}/deliverables`, { kind: "text", content });
    expect(r.statusCode).toBe(202);
    await h.s.deals.idle();
  };
  const tick = () => h.s.sweeper.tick();
  /** As the webhook route does: store the verified event, then process it. */
  const webhook = async (e: { id: string; event_type: string; resource: any }) => {
    await db.webhookEvent.create({ data: { eventId: e.id, eventType: e.event_type, raw: e } });
    await h.s.processor.process(e);
  };

  it("PASS: capture (final) -> GET capture -> payout -> RELEASED, each with a PolicyDecision", async () => {
    const id = await dealTo(h, "LOCKED");
    await deliver(id, "https://example.test/site");
    expect((await deal(id)).state).toBe("RELEASED");

    const cap = h.sim.calls("POST", /\/capture$/);
    expect(cap).toHaveLength(1);
    expect(cap[0]!.body).toEqual({
      amount: { currency_code: "USD", value: "300.00" },
      final_capture: true,
    });
    expect(h.sim.calls("GET", /^\/v2\/payments\/captures\//)).toHaveLength(1); // C7 re-check
    const payout = h.sim.calls("POST", /^\/v1\/payments\/payouts$/)[0]!.body as any;
    expect(payout.sender_batch_header.sender_batch_id).toBe(`paylock-${id}-1`);
    expect(payout.items[0]).toMatchObject({
      sender_item_id: id,
      amount: { value: "300.00", currency: "USD" },
    });

    const [c] = await records(id, "CAPTURE");
    const [p] = await records(id, "PAYOUT");
    expect(c).toMatchObject({ status: "SUCCEEDED", paypalStatus: "COMPLETED" });
    expect(p).toMatchObject({ status: "SUCCEEDED", paypalStatus: "SUCCESS" });
    const pds = await db.policyDecision.findMany({
      where: { id: { in: [c!.policyDecisionId!, p!.policyDecisionId!] } },
    });
    expect(pds.map((x) => [x.action, x.result])).toEqual(
      expect.arrayContaining([
        ["capture", "ALLOW"],
        ["payout", "ALLOW"],
      ]),
    );
    expect(pds.every((x) => x.decisionId)).toBe(true);
  });

  it("PARTIAL at 80: one final capture of 240.00 and a 240.00 payout -> RELEASED_PARTIAL", async () => {
    const id = await dealTo(h, "LOCKED");
    await deliver(id, "PARTIAL delivery");
    expect((await deal(id)).state).toBe("RELEASED_PARTIAL");
    expect((h.sim.calls("POST", /\/capture$/)[0]!.body as any).amount.value).toBe("240.00");
    expect(h.sim.calls("POST", /\/void$/)).toHaveLength(0); // final capture releases the rest (C6)
  });

  it("FAIL: void -> VOIDED, never a capture", async () => {
    const id = await dealTo(h, "LOCKED");
    await deliver(id, "FAIL: nothing useful here");
    const d = await deal(id);
    expect([d.state, d.blockReason]).toEqual(["VOIDED", "VERIFICATION_FAILED"]);
    expect(h.sim.calls("POST", /\/capture$/)).toHaveLength(0);
    expect(h.sim.auths.get(d.paypalAuthId!)!.status).toBe("VOIDED");
  });

  it("PENDING capture: 'Confirming with PayPal', no payout until GET says COMPLETED", async () => {
    const id = await dealTo(h, "LOCKED");
    h.sim.nextCaptureStatus = "PENDING";
    await deliver(id, "ok");
    expect((await deal(id)).state).toBe("RELEASING");
    const ev = await db.dealEvent.findFirstOrThrow({
      where: { dealId: id, type: "settlement.confirming" },
    });
    expect(ev.payload).toMatchObject({ step: "capture", message: "Confirming with PayPal…" });
    await tick();
    expect(h.sim.calls("POST", /payouts$/)).toHaveLength(0);
    // PayPal finishes its review.
    for (const c of h.sim.captures.values()) c.status = "COMPLETED";
    await tick();
    expect((await deal(id)).state).toBe("RELEASED");
    expect(h.sim.calls("POST", /payouts$/)).toHaveLength(1);
    expect(await db.dealEvent.count({ where: { dealId: id, type: "settlement.confirming" } })).toBe(
      1,
    ); // capture only; the payout settled on the first poll
  });

  it("PENDING then DECLINED capture -> SETTLEMENT_ERROR, no payout", async () => {
    const id = await dealTo(h, "LOCKED");
    h.sim.nextCaptureStatus = "PENDING";
    await deliver(id, "ok");
    for (const c of h.sim.captures.values()) c.status = "DECLINED";
    await tick();
    expect((await deal(id)).state).toBe("SETTLEMENT_ERROR");
    expect(h.sim.calls("POST", /payouts$/)).toHaveLength(0);
  });

  it("C7: GET capture amount differs from the request -> SETTLEMENT_ERROR, no payout", async () => {
    const id = await dealTo(h, "LOCKED");
    h.sim.captureGetAmount = "1.00";
    await deliver(id, "ok");
    expect((await deal(id)).state).toBe("SETTLEMENT_ERROR");
    const [c] = await records(id, "CAPTURE");
    expect(c!.error).toMatchObject({ name: "CAPTURE_AMOUNT_MISMATCH" });
    expect(h.sim.calls("POST", /payouts$/)).toHaveLength(0);
  });

  it("lost capture response: the sweeper resumes with the same key; PayPal dedups; one capture", async () => {
    const id = await dealTo(h, "LOCKED");
    h.sim.fail(/\/capture$/, "lost-response");
    await deliver(id, "ok");
    expect((await deal(id)).state).toBe("RELEASING");
    await tick();
    expect((await deal(id)).state).toBe("RELEASED");
    const posts = h.sim.calls("POST", /\/capture$/);
    expect(posts).toHaveLength(2);
    expect(posts[0]!.requestId).toBe(posts[1]!.requestId);
    expect(h.sim.captures.size).toBe(1);
  });

  it("lost payout response: re-POST hits the used sender_batch_id; batch id recovered from the PAYOUTS-ITEM webhook", async () => {
    const id = await dealTo(h, "LOCKED");
    h.sim.fail(/payouts$/, "lost-response");
    h.sim.payoutItemStatus = "PENDING";
    await deliver(id, "ok");
    await tick(); // re-POST -> 400 USER_BUSINESS_ERROR (C8): treated as already sent
    const [p] = await records(id, "PAYOUT");
    expect(p).toMatchObject({ status: "PENDING", paypalId: null });
    expect(p!.raw).toMatchObject({ duplicateBatch: true });
    await tick(); // never re-POSTs again
    expect(h.sim.calls("POST", /payouts$/)).toHaveLength(2);
    expect(h.sim.batches.size).toBe(1);

    const batch = [...h.sim.batches.values()][0]!;
    batch.itemStatus = "SUCCESS";
    await webhook({
      id: "WH-ITEM-1",
      event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      resource: {
        payout_item_id: `I${batch.id}`,
        payout_batch_id: batch.id,
        transaction_status: "SUCCESS",
        payout_item: { sender_item_id: id },
      } as any,
    });
    const after = (await records(id, "PAYOUT"))[0]!;
    expect(after.paypalId).toBe(batch.id);
    expect((await deal(id)).state).toBe("RELEASED");
  });

  it("payout item FAILED -> SETTLEMENT_ERROR; retry re-sends with a new sender_batch_id", async () => {
    const id = await dealTo(h, "LOCKED");
    h.sim.payoutItemStatus = "FAILED";
    await deliver(id, "ok");
    expect((await deal(id)).state).toBe("SETTLEMENT_ERROR");
    h.sim.payoutItemStatus = "SUCCESS";
    const r = await h.as("buyer", "POST", `/deals/${id}/settlement/retry`);
    expect(r.json()).toMatchObject({ retried: "payout", state: "RELEASED" });
    const ids = h.sim
      .calls("POST", /payouts$/)
      .map((c) => (c.body as any).sender_batch_header.sender_batch_id);
    expect(ids).toEqual([`paylock-${id}-1`, `paylock-${id}-2`]);
    const items = h.sim
      .calls("POST", /payouts$/)
      .map((c) => (c.body as any).items[0].sender_item_id);
    expect(items).toEqual([id, id]);
    expect(h.sim.calls("POST", /\/capture$/)).toHaveLength(1); // capture is not repeated
  });

  it("payout UNCLAIMED keeps polling and is never re-sent", async () => {
    const id = await dealTo(h, "LOCKED");
    h.sim.payoutItemStatus = "UNCLAIMED";
    await deliver(id, "ok");
    await tick();
    await tick();
    expect((await deal(id)).state).toBe("RELEASING");
    expect(h.sim.calls("POST", /payouts$/)).toHaveLength(1);
    expect((await h.as("buyer", "POST", `/deals/${id}/settlement/retry`)).statusCode).toBe(409);
  });

  it("refund after a payout that cannot succeed -> VOIDED REFUNDED (P2)", async () => {
    const id = await dealTo(h, "LOCKED");
    h.sim.payoutItemStatus = "RETURNED";
    await deliver(id, "ok");
    expect((await deal(id)).state).toBe("SETTLEMENT_ERROR");
    const r = await h.as("buyer", "POST", `/deals/${id}/settlement/refund`);
    expect(r.json()).toMatchObject({ state: "VOIDED", blockReason: "REFUNDED" });
    const [rf] = await records(id, "REFUND");
    expect(rf!.policyDecisionId).not.toBeNull();
    expect((h.sim.calls("POST", /\/refund$/)[0]!.body as any).amount.value).toBe("300.00");
  });

  it("refund is refused while the payout could still succeed", async () => {
    const id = await dealTo(h, "LOCKED");
    h.frozen.value = false;
    h.sim.fail(/\/capture$/, {
      status: 422,
      body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "PAYEE_ACCOUNT_RESTRICTED" }] },
    });
    await deliver(id, "ok");
    expect((await deal(id)).state).toBe("SETTLEMENT_ERROR");
    expect((await h.as("buyer", "POST", `/deals/${id}/settlement/refund`)).statusCode).toBe(409);
    // Capture failed definitively: retry makes a new capture attempt with a new key.
    const r = await h.as("buyer", "POST", `/deals/${id}/settlement/retry`);
    expect(r.json()).toMatchObject({ retried: "capture", state: "RELEASED" });
    const keys = h.sim.calls("POST", /\/capture$/).map((c) => c.requestId);
    expect(new Set(keys).size).toBe(2);
  });

  it("PAYLOCK_FREEZE blocks capture (SETTLEMENT_ERROR) but still allows a void", async () => {
    const a = await dealTo(h, "LOCKED");
    const b = await dealTo(h, "LOCKED", "Second job, budget $100");
    h.frozen.value = true;
    await deliver(a, "ok");
    expect((await deal(a)).state).toBe("SETTLEMENT_ERROR");
    expect(h.sim.calls("POST", /\/capture$/)).toHaveLength(0);
    await deliver(b, "FAIL");
    expect((await deal(b)).state).toBe("VOIDED");
    h.frozen.value = false;
    expect((await h.as("buyer", "POST", `/deals/${a}/settlement/retry`)).json().state).toBe(
      "RELEASED",
    );
  });

  it("an overridden deal goes to NEEDS_REVIEW; human approve releases, reject voids", async () => {
    const a = await dealTo(h, "LOCKED");
    const b = await dealTo(h, "LOCKED", "Another job, budget $50");
    await db.deal.updateMany({
      where: { id: { in: [a, b] } },
      data: { requiresHumanRelease: true },
    });
    await deliver(a, "ok");
    await deliver(b, "ok");
    expect((await deal(a)).state).toBe("NEEDS_REVIEW");
    const decA = await db.decision.findFirstOrThrow({ where: { dealId: a } });
    const decB = await db.decision.findFirstOrThrow({ where: { dealId: b } });
    const ra = await h.as("buyer", "POST", `/deals/${a}/decisions/${decA.id}/override`, {
      action: "approve",
      reason: "Checked it myself",
    });
    expect(ra.json().state).toBe("RELEASED");
    const rb = await h.as("buyer", "POST", `/deals/${b}/decisions/${decB.id}/override`, {
      action: "reject",
      reason: "Not what I asked",
    });
    expect(rb.json()).toMatchObject({ state: "VOIDED", blockReason: "HUMAN_REJECTED" });
  });

  it("a failed void -> SETTLEMENT_ERROR; retry resumes the void", async () => {
    const id = await dealTo(h, "LOCKED");
    h.sim.fail(/\/void$/, { status: 500, body: { name: "INTERNAL_SERVER_ERROR" } });
    h.sim.fail(/\/void$/, {
      status: 422,
      body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "SOMETHING" }] },
    });
    await deliver(id, "FAIL");
    // First try: 500 -> unknown outcome, still VERIFYING; sweeper retry gets a definitive 422.
    await db.deal.update({ where: { id }, data: { updatedAt: new Date(Date.now() - 60_000) } });
    await db.paymentRecord.updateMany({
      where: { dealId: id },
      data: { updatedAt: new Date(Date.now() - 60_000) },
    });
    await tick();
    expect((await deal(id)).state).toBe("SETTLEMENT_ERROR");
    const r = await h.as("buyer", "POST", `/deals/${id}/settlement/retry`);
    expect(r.json()).toMatchObject({ retried: "void", state: "VOIDED" });
  });

  it("an expired authorization -> VOIDED AUTH_EXPIRED via the sweeper", async () => {
    const id = await dealTo(h, "LOCKED");
    await db.deal.update({ where: { id }, data: { authExpiresAt: new Date(Date.now() - 1000) } });
    await tick();
    const d = await deal(id);
    expect([d.state, d.blockReason]).toEqual(["VOIDED", "AUTH_EXPIRED"]);
    const ev = await db.dealEvent.findFirstOrThrow({
      where: { dealId: id, type: "authorization.expired" },
    });
    expect(ev.payload).toMatchObject({ message: "Reservation expired" });
  });

  it("webhooks append once per resource and status and never regress state", async () => {
    const id = await dealTo(h, "LOCKED");
    await deliver(id, "ok");
    const d = await deal(id);
    expect(d.state).toBe("RELEASED");
    const late = (eventId: string) =>
      webhook({
        id: eventId,
        event_type: "PAYMENT.AUTHORIZATION.CREATED",
        resource: { id: d.paypalAuthId!, status: "CREATED", custom_id: id },
      });
    await late("WH-1");
    await late("WH-2"); // PayPal repeats events with new ids
    expect((await deal(id)).state).toBe("RELEASED");
    expect(await db.dealEvent.count({ where: { dealId: id, type: "paypal.confirmed" } })).toBe(1);
  });

  it("a CAPTURE.COMPLETED webhook confirms by GET but never sends the payout itself", async () => {
    const id = await dealTo(h, "LOCKED");
    h.sim.nextCaptureStatus = "PENDING";
    await deliver(id, "ok");
    const cap = [...h.sim.captures.values()][0]!;
    cap.status = "COMPLETED";
    await webhook({
      id: "WH-CAP",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: cap.id, status: "COMPLETED", custom_id: id },
    });
    const [c] = await records(id, "CAPTURE");
    expect(c!.status).toBe("SUCCEEDED");
    expect(h.sim.calls("POST", /payouts$/)).toHaveLength(0); // money writes come from the sweeper only
    await tick();
    expect((await deal(id)).state).toBe("RELEASED");
  });

  it("a payout webhook for an unknown resource is ignored", async () => {
    await webhook({
      id: "WH-X",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "NOPE" },
    });
    expect(await db.dealEvent.count()).toBe(0);
  });
});
