import type { Deal } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireHuman, requireScope, requireUser, type Principal } from "../auth/plugin.js";
import { ProblemError } from "../lib/problem.js";
import { parseBody } from "../lib/validate.js";
import type { Services } from "../services.js";
import { eventView, dealView } from "./view.js";

const CreateDeal = z.object({
  sellerId: z.string().min(1).max(64),
  request: z.string().min(10).max(4000),
});
const Message = z.object({ body: z.string().min(1).max(4000) });
const Override = z.object({ reason: z.string().trim().min(3).max(500) });
const Deliverable = z.object({
  kind: z.enum(["url", "text", "repo"]),
  content: z.string().min(1).max(200_000),
  note: z.string().max(2000).optional(),
});
const DecisionOverride = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(3).max(500),
});

const Params = z.object({ id: z.string().min(1).max(64) });

/** REST routes for deals (DESIGN.md section 4). Errors are RFC 7807 problems. */
export async function dealRoutes(app: FastifyInstance, s: Services) {
  async function load(req: FastifyRequest, p: Principal, role?: "buyer" | "seller"): Promise<Deal> {
    const { id } = parseBody(Params, req.params);
    const deal = await s.db.deal.findUnique({ where: { id } });
    // 404 for non-parties too, so deal ids are not probeable.
    if (!deal || (deal.buyerId !== p.user.id && deal.sellerId !== p.user.id))
      throw new ProblemError(404, "not-found", "Deal not found");
    if (role === "buyer" && deal.buyerId !== p.user.id)
      throw new ProblemError(403, "forbidden", "Only the buyer can do this");
    if (role === "seller" && deal.sellerId !== p.user.id)
      throw new ProblemError(403, "forbidden", "Only the seller can do this");
    return deal;
  }
  const view = (id: string) => dealView(s.db, id);

  app.post("/deals", async (req, reply) => {
    const p = requireScope(req, "deals:write");
    const body = parseBody(CreateDeal, req.body);
    const deal = await s.deals.create(p.user, body);
    return reply.status(201).send(await view(deal.id));
  });

  app.get("/deals", async (req) => {
    const p = requireUser(req);
    const deals = await s.db.deal.findMany({
      where: { OR: [{ buyerId: p.user.id }, { sellerId: p.user.id }] },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        contract: { select: { title: true } },
        seller: { select: { displayName: true } },
        buyer: { select: { displayName: true } },
      },
    });
    return {
      deals: deals.map((d) => ({
        id: d.id,
        state: d.state,
        amount: d.amount.toFixed(2),
        currency: d.currency,
        title: d.contract?.title ?? null,
        buyer: d.buyer.displayName,
        seller: d.seller.displayName,
        role: d.buyerId === p.user.id ? "buyer" : "seller",
        createdAt: d.createdAt.toISOString(),
      })),
    };
  });

  app.get("/deals/:id", async (req) => {
    const deal = await load(req, requireUser(req));
    return view(deal.id);
  });

  app.post("/deals/:id/messages", async (req, reply) => {
    const p = requireScope(req, "deals:write");
    const deal = await load(req, p);
    const msg = await s.deals.addMessage(deal, p.user, parseBody(Message, req.body).body);
    return reply.status(201).send({ id: msg.id });
  });

  app.post("/deals/:id/guard", async (req) => {
    const p = requireScope(req, "deals:write");
    const deal = await load(req, p, "buyer");
    const r = await s.deals.guard(deal.id, p.user.id);
    return {
      ...(await view(deal.id)),
      policy: { result: r.policy.result, reasons: r.policy.reasons },
    };
  });

  app.post("/deals/:id/approve", async (req) => {
    const p = requireHuman(req);
    const deal = await load(req, p, "buyer");
    await s.deals.approve(deal.id, p.user.id);
    return view(deal.id);
  });

  app.post("/deals/:id/override", async (req) => {
    const p = requireHuman(req);
    const deal = await load(req, p, "buyer");
    await s.deals.override(deal.id, p.user.id, parseBody(Override, req.body).reason);
    return view(deal.id);
  });

  app.post("/deals/:id/cancel", async (req) => {
    const p = requireScope(req, "deals:write");
    const deal = await load(req, p, "buyer");
    await s.deals.cancel(deal.id, p.user.id);
    return view(deal.id);
  });

  app.post("/deals/:id/fund", async (req) => {
    const p = requireHuman(req);
    const deal = await load(req, p, "buyer");
    const r = await s.funding.fund(deal.id, p.user.id);
    return { orderId: r.orderId, approveUrl: r.approveUrl ?? null };
  });

  // Called from the v6 onApprove. Any orderId in the body is ignored on purpose.
  app.post("/deals/:id/authorize", async (req) => {
    const p = requireHuman(req);
    const deal = await load(req, p, "buyer");
    await s.funding.authorize(deal.id, p.user.id);
    return view(deal.id);
  });

  app.post("/deals/:id/deliverables", async (req, reply) => {
    const p = requireScope(req, "deliverables:write");
    const deal = await load(req, p, "seller");
    await s.deals.submitDeliverable(deal.id, p.user, parseBody(Deliverable, req.body));
    return reply.status(202).send(await view(deal.id));
  });

  app.post("/deals/:id/decisions/:decisionId/override", async (req) => {
    const p = requireHuman(req);
    const deal = await load(req, p, "buyer");
    const { decisionId } = parseBody(
      z.object({ decisionId: z.string().min(1).max(64) }),
      req.params,
    );
    const body = parseBody(DecisionOverride, req.body);
    await s.deals.decide(deal.id, decisionId, p.user.id, body.action, body.reason);
    return view(deal.id);
  });

  app.post("/deals/:id/settlement/retry", async (req) => {
    const p = requireHuman(req);
    const deal = await load(req, p, "buyer");
    const r = await s.settlement.retry(deal.id, p.user.id);
    return { ...(await view(deal.id)), retried: r.step };
  });

  app.post("/deals/:id/settlement/refund", async (req) => {
    const p = requireHuman(req);
    const deal = await load(req, p, "buyer");
    await s.settlement.refund(deal.id, p.user.id);
    return view(deal.id);
  });

  // SSE timeline (decision J): replay after Last-Event-ID, then live events, 15s heartbeat.
  app.get("/deals/:id/events", async (req, reply) => {
    const deal = await load(req, requireUser(req));
    const lastId =
      (req.headers["last-event-id"] as string | undefined) ??
      (req.query as { lastEventId?: string } | undefined)?.lastEventId;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "x-request-id": req.id,
    });
    res.write("retry: 2000\n\n");
    const sent = new Set<string>();
    const send = (e: Parameters<typeof eventView>[0]) => {
      if (sent.has(e.id)) return;
      sent.add(e.id);
      res.write(`id: ${e.id}\nevent: deal\ndata: ${JSON.stringify(eventView(e))}\n\n`);
    };
    const buffered: Parameters<typeof eventView>[0][] = [];
    let replaying = true;
    const unsubscribe = s.bus.subscribe(deal.id, (e) => (replaying ? buffered.push(e) : send(e)));
    const anchor = lastId
      ? await s.db.dealEvent.findFirst({ where: { id: lastId, dealId: deal.id } })
      : null;
    const past = await s.db.dealEvent.findMany({
      where: { dealId: deal.id, ...(anchor ? { createdAt: { gte: anchor.createdAt } } : {}) },
      orderBy: { createdAt: "asc" },
    });
    if (anchor) sent.add(anchor.id);
    for (const e of past) send(e);
    replaying = false;
    for (const e of buffered) send(e);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
