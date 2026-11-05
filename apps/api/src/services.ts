import type { PrismaClient } from "@prisma/client";
import type { Agents } from "./agents/types.js";
import type { Config } from "./config/env.js";
import type { DealEventBus } from "./deals/bus.js";
import type { DealExecutor } from "./deals/executor.js";
import { FundingService } from "./deals/funding.js";
import { DealService } from "./deals/service.js";
import type { PayPalLogger } from "./paypal/http.js";
import type { PayPalPort } from "./paypal/port.js";
import { Settlement } from "./settlement/settlement.js";
import { Sweeper } from "./settlement/sweeper.js";
import { WebhookProcessor } from "./webhooks/processor.js";
import type { WebhookStore } from "./webhooks/store.js";

/** Everything the deal routes need, wired once (server.ts) or per test. */
export interface Services {
  db: PrismaClient;
  exec: DealExecutor;
  bus: DealEventBus;
  funding: FundingService;
  settlement: Settlement;
  deals: DealService;
  sweeper: Sweeper;
  processor: WebhookProcessor;
  reconcile: (dealId: string) => Promise<void>;
}

export function buildServices(i: {
  config: Config;
  db: PrismaClient;
  exec: DealExecutor;
  bus: DealEventBus;
  paypal: PayPalPort;
  agents: Agents;
  store: WebhookStore;
  log: PayPalLogger;
  isFrozen?: () => boolean;
}): Services {
  const isFrozen = i.isFrozen ?? (() => i.config.freeze);
  const settlement = new Settlement({
    db: i.db,
    exec: i.exec,
    paypal: i.paypal,
    isFrozen,
    log: i.log,
  });
  const funding = new FundingService({
    db: i.db,
    exec: i.exec,
    paypal: i.paypal,
    voider: settlement,
    isFrozen,
    appUrl: i.config.appUrl,
    authSafeWindowHours: i.config.authSafeWindowHours,
    log: i.log,
  });
  const deals = new DealService({
    db: i.db,
    exec: i.exec,
    agents: i.agents,
    settlement,
    log: i.log,
  });
  const reconcile = async (dealId: string) => {
    await funding.refreshPendingAuthorization(dealId);
    await settlement.refresh(dealId);
  };
  const processor = new WebhookProcessor(i.store, i.log, {
    db: i.db,
    exec: i.exec,
    paypal: i.paypal,
    reconcile,
  });
  const sweeper = new Sweeper({
    db: i.db,
    exec: i.exec,
    funding,
    settlement,
    verify: (id) => deals.runVerification(id),
    reprocessWebhook: (e) => processor.process(e),
    fundingTimeoutMinutes: i.config.fundingTimeoutMinutes,
    log: i.log,
  });
  return {
    db: i.db,
    exec: i.exec,
    bus: i.bus,
    funding,
    settlement,
    deals,
    sweeper,
    processor,
    reconcile,
  };
}
