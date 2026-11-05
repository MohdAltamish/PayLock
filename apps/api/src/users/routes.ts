import { compareMoney, Money, toMoney } from "@paylock/schemas";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireHuman, requireUser } from "../auth/plugin.js";
import { ProblemError } from "../lib/problem.js";
import { parseBody } from "../lib/validate.js";

const Policy = z
  .object({
    maxPerDeal: Money,
    dailyCap: Money,
    approvalThreshold: Money,
    allowMediumRisk: z.boolean(),
  })
  .refine((p) => compareMoney(p.maxPerDeal, p.dailyCap) <= 0, "maxPerDeal must not exceed dailyCap")
  .refine(
    (p) => compareMoney(p.approvalThreshold, p.maxPerDeal) <= 0,
    "approvalThreshold must not exceed maxPerDeal",
  );

/** Spend policy (owner only, human only) and counterparty reports. */
export async function userRoutes(app: FastifyInstance, o: { db: PrismaClient }) {
  const own = (reqId: string, userId: string) => {
    if (reqId !== userId) throw new ProblemError(403, "forbidden", "Only for your own account");
  };

  app.get("/users/:id/policy", async (req) => {
    const p = requireUser(req);
    const { id } = parseBody(z.object({ id: z.string() }), req.params);
    own(id, p.user.id);
    const pol = await o.db.spendPolicy.findUnique({ where: { userId: id } });
    if (!pol) throw new ProblemError(404, "not-found", "No spend policy");
    return {
      maxPerDeal: toMoney(pol.maxPerDeal.toString()),
      dailyCap: toMoney(pol.dailyCap.toString()),
      approvalThreshold: toMoney(pol.approvalThreshold.toString()),
      allowMediumRisk: pol.allowMediumRisk,
      currency: pol.currency,
    };
  });

  app.put("/users/:id/policy", async (req) => {
    const p = requireHuman(req);
    const { id } = parseBody(z.object({ id: z.string() }), req.params);
    own(id, p.user.id);
    const body = parseBody(Policy, req.body);
    const pol = await o.db.spendPolicy.upsert({
      where: { userId: id },
      create: { userId: id, ...body },
      update: body,
    });
    return {
      maxPerDeal: toMoney(pol.maxPerDeal.toString()),
      dailyCap: toMoney(pol.dailyCap.toString()),
      approvalThreshold: toMoney(pol.approvalThreshold.toString()),
      allowMediumRisk: pol.allowMediumRisk,
      currency: pol.currency,
    };
  });

  app.post("/users/:id/reports", async (req, reply) => {
    const p = requireHuman(req);
    const { id } = parseBody(z.object({ id: z.string() }), req.params);
    if (id === p.user.id) throw new ProblemError(400, "bad-request", "You cannot report yourself");
    const body = parseBody(
      z.object({
        reason: z.string().trim().min(3).max(500),
        dealId: z.string().max(64).optional(),
      }),
      req.body,
    );
    const subject = await o.db.user.findUnique({ where: { id } });
    if (!subject) throw new ProblemError(404, "not-found", "User not found");
    const report = await o.db.$transaction(async (tx) => {
      const r = await tx.report.create({
        data: {
          reporterId: p.user.id,
          subjectId: id,
          reason: body.reason,
          dealId: body.dealId ?? null,
        },
      });
      await tx.trustProfile.upsert({
        where: { userId: id },
        create: { userId: id, reportsReceived: 1 },
        update: { reportsReceived: { increment: 1 } },
      });
      return r;
    });
    return reply.status(201).send({ id: report.id });
  });
}
