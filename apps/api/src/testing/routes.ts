import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireHuman } from "../auth/plugin.js";
import { dealView } from "../deals/view.js";
import { ProblemError } from "../lib/problem.js";
import { parseBody } from "../lib/validate.js";
import type { Services } from "../services.js";

/**
 * POST /test/fund-with-card (BUILD_PLAN 2.4, C13). Funds a GUARDED deal with
 * the sandbox test card, server side, so E2E tests and curl-happy.sh need no
 * buyer popup. app.ts registers it only when config.e2eCardFunding is true
 * (PAYPAL_ENV=sandbox, E2E_FUNDING=card, NODE_ENV != production); otherwise
 * the path is a 404.
 */
export async function testingRoutes(app: FastifyInstance, s: Services) {
  app.post("/test/fund-with-card", async (req) => {
    const p = requireHuman(req);
    const body = parseBody(
      z.object({
        dealId: z.string().min(1).max(64),
        // Sandbox negative testing (C11), e.g. INSTRUMENT_DECLINED.
        mock: z
          .string()
          .regex(/^[A-Z_]{3,64}$/)
          .optional(),
      }),
      req.body,
    );
    const deal = await s.db.deal.findUnique({ where: { id: body.dealId } });
    if (!deal || deal.buyerId !== p.user.id)
      throw new ProblemError(404, "not-found", "Deal not found");
    await s.funding.fundWithCard(
      deal.id,
      p.user.id,
      body.mock ? { mockApplicationCode: body.mock } : undefined,
    );
    return dealView(s.db, deal.id);
  });
}
