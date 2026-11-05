import type { FastifyInstance } from "fastify";

export type HealthCheck = () => Promise<void>;

export interface HealthDeps {
  checks: Record<string, HealthCheck>;
}

/**
 * GET /healthz: 200 when every check passes, 503 otherwise.
 * Check failures report only the check name and "error"; details go to logs.
 */
export async function healthRoutes(app: FastifyInstance, deps: HealthDeps) {
  app.get("/healthz", async (req, reply) => {
    const results: Record<string, "ok" | "error"> = {};
    await Promise.all(
      Object.entries(deps.checks).map(async ([name, check]) => {
        try {
          await check();
          results[name] = "ok";
        } catch (err) {
          req.log.warn({ check: name, err: (err as Error).message }, "health check failed");
          results[name] = "error";
        }
      }),
    );
    const healthy = Object.values(results).every((r) => r === "ok");
    return reply
      .status(healthy ? 200 : 503)
      .send({ status: healthy ? "ok" : "degraded", checks: results });
  });
}
