import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { StubAgents } from "../agents/stub.js";
import type { Agents } from "../agents/types.js";
import { buildApp } from "../app.js";
import { DealEventBus } from "../deals/bus.js";
import { DealExecutor } from "../deals/executor.js";
import { PayPalAdapter } from "../paypal/adapter.js";
import { buildServices, type Services } from "../services.js";
import { PrismaWebhookStore } from "../webhooks/store.js";
import { testConfig } from "./helpers.js";
import { PayPalSim } from "./paypal-sim.js";

const quiet = {
  info() {},
  warn: (o: object, m: string) => process.env.DEBUG_TESTS && console.warn(m, o),
  error: (o: object, m: string) => process.env.DEBUG_TESTS && console.error(m, o),
  debug() {},
};

export interface Harness {
  app: FastifyInstance;
  s: Services;
  sim: PayPalSim;
  db: PrismaClient;
  frozen: { value: boolean };
  buyer: { id: string; cookie: string };
  seller: { id: string; cookie: string };
  /** inject with the given session cookie. */
  as(
    who: "buyer" | "seller",
    method: string,
    url: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse>;
}

/** API + real adapter over the in-memory PayPal sandbox (mocked PayPal) + Postgres test DB. */
export async function harness(
  db: PrismaClient,
  opts: {
    env?: Record<string, string>;
    agents?: Agents;
    seller?: Partial<{ paypalEmail: string | null }>;
  } = {},
): Promise<Harness> {
  const config = testConfig({ E2E_FUNDING: "card", SWEEPER_INTERVAL_MS: "0", ...opts.env });
  const sim = new PayPalSim();
  const frozen = { value: false };
  const paypal = new PayPalAdapter(sim.http, { isFrozen: () => frozen.value });
  const bus = new DealEventBus();
  const exec = new DealExecutor(db, bus);
  const s = buildServices({
    config,
    db,
    exec,
    bus,
    paypal,
    agents: opts.agents ?? new StubAgents(),
    store: new PrismaWebhookStore(db),
    log: quiet,
    isFrozen: () => frozen.value,
  });
  const app = await buildApp({ config, deps: { healthChecks: {}, services: s }, logger: false });

  const buyer = await db.user.create({
    data: {
      email: `buyer-${Date.now()}-${Math.random()}@buyers.test`,
      displayName: "Demo Buyer",
      isDemo: true,
      spendPolicy: {
        create: { maxPerDeal: "1000.00", dailyCap: "3000.00", approvalThreshold: "500.00" },
      },
    },
  });
  const seller = await db.user.create({
    data: {
      email: `seller-${Date.now()}-${Math.random()}@sellers.test`,
      displayName: "Honest Seller",
      paypalEmail:
        opts.seller && "paypalEmail" in opts.seller
          ? opts.seller.paypalEmail
          : "payee@sellers.test",
      isDemo: true,
      trustProfile: {
        create: {
          accountCreatedAt: new Date(Date.now() - 400 * 86_400_000),
          completedDeals: 24,
          paypalVerified: true,
        },
      },
    },
  });
  const login = async (userId: string) => {
    const r = await app.inject({ method: "POST", url: "/auth/demo-login", payload: { userId } });
    return String(r.headers["set-cookie"]).split(";")[0]!;
  };
  const h: Harness = {
    app,
    s,
    sim,
    db,
    frozen,
    buyer: { id: buyer.id, cookie: await login(buyer.id) },
    seller: { id: seller.id, cookie: await login(seller.id) },
    as: (who, method, url, payload) =>
      app.inject({
        method: method as "POST",
        url,
        payload: payload as object,
        headers: { cookie: h[who].cookie },
      }),
  };
  return h;
}

/** Create a deal and run it to the given state through the API. */
export async function dealTo(
  h: Harness,
  target: "CONTRACTED" | "GUARDED" | "FUNDING" | "LOCKED",
  request = "Landing page for my bakery, mobile friendly, budget $300",
): Promise<string> {
  const r = await h.as("buyer", "POST", "/deals", { sellerId: h.seller.id, request });
  if (r.statusCode !== 201) throw new Error(`create failed: ${r.body}`);
  const id = r.json().id as string;
  if (target === "CONTRACTED") return id;
  const g = await h.as("buyer", "POST", `/deals/${id}/guard`);
  if (g.json().state !== "GUARDED") throw new Error(`guard: ${g.body}`);
  if (target === "GUARDED") return id;
  const f = await h.as("buyer", "POST", `/deals/${id}/fund`);
  if (f.statusCode !== 200) throw new Error(`fund: ${f.body}`);
  if (target === "FUNDING") return id;
  h.sim.approve(f.json().orderId);
  const a = await h.as("buyer", "POST", `/deals/${id}/authorize`, {});
  if (a.json().state !== "LOCKED") throw new Error(`authorize: ${a.body}`);
  return id;
}
