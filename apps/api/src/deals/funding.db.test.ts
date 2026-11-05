import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { dbAvailable, resetDb, testDb } from "../test/db.js";
import { dealTo, harness, type Harness } from "../test/harness.js";
import { testConfig } from "../test/helpers.js";

const DECLINED = {
  status: 422,
  body: {
    name: "UNPROCESSABLE_ENTITY",
    message: "declined",
    details: [{ issue: "INSTRUMENT_DECLINED" }],
  },
};

describe.skipIf(!dbAvailable())("funding API (mocked PayPal)", () => {
  const db = testDb();
  let h: Harness;
  beforeEach(async () => {
    await resetDb(db);
    h = await harness(db);
  });

  const deal = (id: string) =>
    db.deal.findUniqueOrThrow({ where: { id }, include: { contract: true } });

  it("create -> guard -> GUARDED with a guard PolicyDecision", async () => {
    const id = await dealTo(h, "GUARDED");
    const d = await deal(id);
    expect(d.state).toBe("GUARDED");
    expect(d.amount.toFixed(2)).toBe("300.00");
    expect(d.payoutEmail).toBe("payee@sellers.test");
    const pds = await db.policyDecision.findMany({ where: { dealId: id } });
    expect(pds.map((p) => [p.action, p.result])).toEqual([["guard", "ALLOW"]]);
  });

  it("/fund is idempotent: a second call returns the same order without a new POST", async () => {
    const id = await dealTo(h, "GUARDED");
    const a = await h.as("buyer", "POST", `/deals/${id}/fund`);
    const b = await h.as("buyer", "POST", `/deals/${id}/fund`);
    expect(a.statusCode).toBe(200);
    expect(a.json().approveUrl).toContain("sandbox.paypal.com");
    expect(b.json()).toEqual(a.json());
    expect(h.sim.calls("POST", /^\/v2\/checkout\/orders$/)).toHaveLength(1);
    const d = await deal(id);
    expect(d.state).toBe("FUNDING");
    expect(d.paypalOrderId).toBe(a.json().orderId);
    const order = h.sim.calls("POST", /^\/v2\/checkout\/orders$/)[0]!;
    expect((order.body as any).intent).toBe("AUTHORIZE");
    expect((order.body as any).purchase_units[0]).toMatchObject({
      custom_id: id,
      amount: { currency_code: "USD", value: "300.00" },
    });
    expect((order.body as any).purchase_units[0].invoice_id).toBeUndefined();
  });

  it("/authorize ignores a client orderId, verifies the stored order, LOCKs and caps the deadline", async () => {
    const id = await dealTo(h, "FUNDING");
    const d0 = await deal(id);
    h.sim.approve(d0.paypalOrderId!);
    const r = await h.as("buyer", "POST", `/deals/${id}/authorize`, { orderId: "ATTACKER0RDER" });
    expect(r.statusCode).toBe(200);
    expect(r.json().state).toBe("LOCKED");
    expect(h.sim.calls("GET", /ATTACKER/)).toHaveLength(0);
    expect(h.sim.calls("GET", new RegExp(`/v2/checkout/orders/${d0.paypalOrderId}$`))).toHaveLength(
      1,
    );
    const d = await deal(id);
    expect(d.paypalAuthId).toMatch(/^A/);
    expect(d.authExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 28 * 86_400_000);
    const capHours = (d.contract!.deadline!.getTime() - Date.now()) / 3600_000;
    expect(capHours).toBeGreaterThan(71);
    expect(capHours).toBeLessThanOrEqual(72);
    const pds = await db.policyDecision.findMany({
      where: { dealId: id },
      orderBy: { createdAt: "asc" },
    });
    expect(pds.map((p) => p.action)).toEqual(["guard", "fund", "authorize", "authorize"]);
    // Replay of onApprove is a no-op.
    const again = await h.as("buyer", "POST", `/deals/${id}/authorize`, {});
    expect(again.json().state).toBe("LOCKED");
    expect(h.sim.calls("POST", /\/authorize$/)).toHaveLength(1);
  });

  it("an order that is not APPROVED -> CANCELLED ORDER_MISMATCH, nothing authorized", async () => {
    const id = await dealTo(h, "FUNDING");
    const r = await h.as("buyer", "POST", `/deals/${id}/authorize`, {});
    expect(r.statusCode).toBe(409);
    expect(r.json().type).toMatch(/order-mismatch$/);
    const d = await deal(id);
    expect([d.state, d.blockReason]).toEqual(["CANCELLED", "ORDER_MISMATCH"]);
    expect(h.sim.calls("POST", /\/authorize$/)).toHaveLength(0);
  });

  it("an order amount that differs from the deal -> ORDER_MISMATCH before authorizing", async () => {
    const id = await dealTo(h, "FUNDING");
    const d0 = await deal(id);
    h.sim.approve(d0.paypalOrderId!);
    h.sim.orders.get(d0.paypalOrderId!)!.amount = "3.00";
    await h.as("buyer", "POST", `/deals/${id}/authorize`, {});
    expect((await deal(id)).blockReason).toBe("ORDER_MISMATCH");
    expect(h.sim.calls("POST", /\/authorize$/)).toHaveLength(0);
  });

  it("an authorization amount that differs -> voided and CANCELLED ORDER_MISMATCH", async () => {
    const id = await dealTo(h, "FUNDING");
    const d0 = await deal(id);
    h.sim.approve(d0.paypalOrderId!);
    h.sim.authAmount = "299.99";
    await h.as("buyer", "POST", `/deals/${id}/authorize`, {});
    const d = await deal(id);
    expect([d.state, d.blockReason]).toEqual(["CANCELLED", "ORDER_MISMATCH"]);
    expect(h.sim.auths.get(d.paypalAuthId!)!.status).toBe("VOIDED");
    const v = await db.paymentRecord.findFirstOrThrow({ where: { dealId: id, kind: "VOID" } });
    expect(v.status).toBe("SUCCEEDED");
    expect(v.policyDecisionId).not.toBeNull();
  });

  it("daily cap is re-checked inside the LOCKED transaction; a new authorization is voided (decision D)", async () => {
    const id = await dealTo(h, "FUNDING");
    const d0 = await deal(id);
    h.sim.approve(d0.paypalOrderId!);
    // Another deal for the same buyer locks 2800.00 while PayPal is authorizing this one.
    h.sim.beforeHandle = async (r) => {
      if (r.path.endsWith("/authorize"))
        await db.deal.create({
          data: { buyerId: h.buyer.id, sellerId: h.seller.id, amount: "2800.00", state: "LOCKED" },
        });
    };
    await h.as("buyer", "POST", `/deals/${id}/authorize`, {});
    const d = await deal(id);
    expect([d.state, d.blockReason]).toEqual(["CANCELLED", "POLICY_CAP"]);
    expect(h.sim.auths.get(d.paypalAuthId!)!.status).toBe("VOIDED");
  });

  it("daily cap already exceeded before authorizing -> CANCELLED POLICY_CAP, no authorization", async () => {
    const id = await dealTo(h, "FUNDING");
    h.sim.approve((await deal(id)).paypalOrderId!);
    await db.deal.create({
      data: { buyerId: h.buyer.id, sellerId: h.seller.id, amount: "2900.00", state: "RELEASED" },
    });
    const r = await h.as("buyer", "POST", `/deals/${id}/authorize`, {});
    expect(r.statusCode).toBe(409);
    expect((await deal(id)).blockReason).toBe("POLICY_CAP");
    expect(h.sim.calls("POST", /\/authorize$/)).toHaveLength(0);
  });

  it("INSTRUMENT_DECLINED -> CANCELLED AUTH_DECLINED with the PayPal reason, not retried", async () => {
    const id = await dealTo(h, "FUNDING");
    h.sim.approve((await deal(id)).paypalOrderId!);
    h.sim.fail(/\/authorize$/, DECLINED);
    const r = await h.as("buyer", "POST", `/deals/${id}/authorize`, {});
    expect(r.statusCode).toBe(422);
    expect(r.json().paypal_issue).toBe("INSTRUMENT_DECLINED");
    expect((await deal(id)).blockReason).toBe("AUTH_DECLINED");
    const ev = await db.dealEvent.findFirstOrThrow({
      where: { dealId: id, type: "funding.failed" },
    });
    expect(ev.payload).toMatchObject({ paypalIssue: "INSTRUMENT_DECLINED" });
  });

  it("a network failure before PayPal saw the authorize is resumed with the same PayPal-Request-Id", async () => {
    const id = await dealTo(h, "FUNDING");
    h.sim.approve((await deal(id)).paypalOrderId!);
    h.sim.fail(/\/authorize$/, "network");
    const r1 = await h.as("buyer", "POST", `/deals/${id}/authorize`, {});
    expect(r1.statusCode).toBe(502);
    expect((await deal(id)).state).toBe("FUNDING");
    const r2 = await h.as("buyer", "POST", `/deals/${id}/authorize`, {});
    expect(r2.json().state).toBe("LOCKED");
    const posts = h.sim.calls("POST", /\/authorize$/);
    expect(posts).toHaveLength(2);
    expect(posts[0]!.requestId).toBe(posts[1]!.requestId);
    expect(h.sim.auths.size).toBe(1);
  });

  it("a lost authorize response is recovered from GET order without a second authorize", async () => {
    const id = await dealTo(h, "FUNDING");
    h.sim.approve((await deal(id)).paypalOrderId!);
    h.sim.fail(/\/authorize$/, "lost-response");
    expect((await h.as("buyer", "POST", `/deals/${id}/authorize`, {})).statusCode).toBe(502);
    const r2 = await h.as("buyer", "POST", `/deals/${id}/authorize`, {});
    expect(r2.json().state).toBe("LOCKED");
    expect(h.sim.calls("POST", /\/authorize$/)).toHaveLength(1);
    expect(h.sim.auths.size).toBe(1);
  });

  it("cancel is refused while an authorization is in flight", async () => {
    const id = await dealTo(h, "FUNDING");
    h.sim.approve((await deal(id)).paypalOrderId!);
    h.sim.fail(/\/authorize$/, "network");
    await h.as("buyer", "POST", `/deals/${id}/authorize`, {});
    const c = await h.as("buyer", "POST", `/deals/${id}/cancel`);
    expect(c.statusCode).toBe(409);
  });

  it("PAYLOCK_FREEZE blocks funding with 503", async () => {
    const id = await dealTo(h, "GUARDED");
    h.frozen.value = true;
    const r = await h.as("buyer", "POST", `/deals/${id}/fund`);
    expect(r.statusCode).toBe(503);
    expect((await deal(id)).state).toBe("GUARDED");
    expect(h.sim.requests).toHaveLength(0);
  });

  it("test card route funds a deal server side (C13)", async () => {
    const id = await dealTo(h, "GUARDED");
    const r = await h.as("buyer", "POST", "/test/fund-with-card", { dealId: id });
    expect(r.statusCode).toBe(200);
    expect(r.json().state).toBe("LOCKED");
    expect(h.sim.calls("POST", /\/authorize$/)).toHaveLength(0);
  });

  it("test card route with a mocked decline -> CANCELLED AUTH_DECLINED", async () => {
    const id = await dealTo(h, "GUARDED");
    const r = await h.as("buyer", "POST", "/test/fund-with-card", {
      dealId: id,
      mock: "INSTRUMENT_DECLINED",
    });
    expect(r.json()).toMatchObject({ state: "CANCELLED", blockReason: "AUTH_DECLINED" });
  });

  it("test card route is 404 under production config and when E2E_FUNDING is off", async () => {
    for (const env of [
      { NODE_ENV: "production", E2E_FUNDING: "card", SESSION_SECRET: "x".repeat(40) },
      { E2E_FUNDING: "off" },
    ] as Array<Record<string, string>>) {
      const app = await buildApp({
        config: testConfig(env),
        deps: { healthChecks: {}, services: h.s },
        logger: false,
      });
      const r = await app.inject({
        method: "POST",
        url: "/test/fund-with-card",
        payload: {},
        headers: { cookie: h.buyer.cookie },
      });
      expect(r.statusCode).toBe(404);
      await app.close();
    }
  });
});

describe.skipIf(!dbAvailable())("deal API auth", () => {
  const db = testDb();
  let h: Harness;
  beforeEach(async () => {
    await resetDb(db);
    h = await harness(db);
  });

  it("401 without a session, 404 for non-parties, 403 for the wrong party", async () => {
    const id = await dealTo(h, "GUARDED");
    expect((await h.app.inject({ method: "GET", url: `/deals/${id}` })).statusCode).toBe(401);
    const stranger = await db.user.create({
      data: { email: "s@x.test", displayName: "S", isDemo: true },
    });
    const login = await h.app.inject({
      method: "POST",
      url: "/auth/demo-login",
      payload: { userId: stranger.id },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    expect(
      (await h.app.inject({ method: "GET", url: `/deals/${id}`, headers: { cookie } })).statusCode,
    ).toBe(404);
    expect((await h.as("seller", "POST", `/deals/${id}/fund`)).statusCode).toBe(403);
  });

  it("refuses cookie writes from a foreign Origin (CSRF)", async () => {
    const id = await dealTo(h, "GUARDED");
    const r = await h.app.inject({
      method: "POST",
      url: `/deals/${id}/fund`,
      headers: { cookie: h.buyer.cookie, origin: "https://evil.example" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("session cookies are httpOnly, SameSite=Lax and tamper-proof", async () => {
    const r = await h.app.inject({
      method: "POST",
      url: "/auth/demo-login",
      payload: { userId: h.buyer.id },
    });
    expect(String(r.headers["set-cookie"])).toMatch(/HttpOnly; SameSite=Lax/);
    const forged = h.buyer.cookie.replace("paylock_session=", "paylock_session=eyJ");
    const me = await h.app.inject({ method: "GET", url: "/auth/me", headers: { cookie: forged } });
    expect(me.statusCode).toBe(401);
  });

  it("agent API keys: scoped writes allowed, human-only actions refused", async () => {
    const k = await h.as("buyer", "POST", `/users/${h.buyer.id}/api-keys`, {
      scopes: ["deals:write"],
    });
    expect(k.statusCode).toBe(201);
    const key = k.json().key as string;
    const hdr = { "x-agent-key": key };
    const created = await h.app.inject({
      method: "POST",
      url: "/deals",
      headers: hdr,
      payload: { sellerId: h.seller.id, request: "Logo design, budget $120" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(
      (await h.app.inject({ method: "POST", url: `/deals/${id}/fund`, headers: hdr })).statusCode,
    ).toBe(403);
    const stored = await db.apiKey.findFirstOrThrow();
    expect(stored.keyHash).not.toContain(key);
    expect(
      (
        await h.app.inject({
          method: "GET",
          url: "/deals",
          headers: { "x-agent-key": "plk_wrong" },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("GET /config/paypal returns only the client id", async () => {
    const r = await h.app.inject({ method: "GET", url: "/config/paypal" });
    expect(r.json()).toEqual({ clientId: "test-client-id", env: "sandbox" });
    expect(r.body).not.toContain("secret");
  });
});
