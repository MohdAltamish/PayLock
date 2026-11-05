import Fastify, { LogController, type FastifyInstance } from "fastify";
import { authPlugin } from "./auth/plugin.js";
import { authRoutes } from "./auth/routes.js";
import type { Config } from "./config/env.js";
import { dealRoutes } from "./deals/routes.js";
import { healthRoutes, type HealthCheck } from "./health/routes.js";
import { loggerOptions } from "./lib/logger.js";
import { registerProblemHandlers } from "./lib/problem.js";
import { genRequestId } from "./lib/request-id.js";
import type { Services } from "./services.js";
import { testingRoutes } from "./testing/routes.js";
import { userRoutes } from "./users/routes.js";
import { webhookRoutes, type WebhookRouteDeps } from "./webhooks/route.js";

export interface AppDeps {
  healthChecks: Record<string, HealthCheck>;
  webhooks?: WebhookRouteDeps;
  /** Deal API. Omitted in tests that only exercise health or webhooks. */
  services?: Services;
}

export interface BuildAppOptions {
  config: Config;
  deps: AppDeps;
  /** Tests pass false to keep output quiet. */
  logger?: boolean;
}

export async function buildApp({
  config,
  deps,
  logger = true,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ? loggerOptions(config.logLevel, config.nodeEnv === "development") : false,
    genReqId: genRequestId,
    // Health checks run every few seconds on Render; keep them out of the logs.
    logController: new LogController({
      requestIdLogLabel: "request_id",
      disableRequestLogging: (req) => req.url === "/healthz",
    }),
    trustProxy: config.nodeEnv === "production", // Render terminates TLS in front of us
    bodyLimit: 1_048_576,
  });

  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });
  registerProblemHandlers(app);

  await app.register(healthRoutes, { checks: deps.healthChecks });
  if (deps.webhooks) await app.register(webhookRoutes, deps.webhooks);

  // Browser-safe PayPal config (decision K): the client id only, never the secret.
  app.get("/config/paypal", async () => ({
    clientId: config.paypal.clientId,
    env: config.paypal.env,
  }));

  const s = deps.services;
  if (s) {
    await app.register(async (scoped) => {
      await scoped.register(authPlugin, {
        db: s.db,
        sessionSecret: config.sessionSecret,
        allowedOrigins: [config.appUrl, config.apiUrl].map((u) => new URL(u).origin),
      });
      await scoped.register(authRoutes, {
        db: s.db,
        sessionSecret: config.sessionSecret,
        secureCookies: config.nodeEnv === "production",
      });
      await scoped.register(userRoutes, { db: s.db });
      await scoped.register(dealRoutes, s);
      // BUILD_PLAN 2.4: only in sandbox, with E2E_FUNDING=card, outside production.
      if (config.e2eCardFunding) await scoped.register(testingRoutes, s);
    });
  }
  return app;
}
