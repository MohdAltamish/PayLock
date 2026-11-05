import Fastify, { LogController, type FastifyInstance } from "fastify";
import type { Config } from "./config/env.js";
import { healthRoutes, type HealthCheck } from "./health/routes.js";
import { loggerOptions } from "./lib/logger.js";
import { registerProblemHandlers } from "./lib/problem.js";
import { genRequestId } from "./lib/request-id.js";

export interface AppDeps {
  healthChecks: Record<string, HealthCheck>;
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

  return app;
}
