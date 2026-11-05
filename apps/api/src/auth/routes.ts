import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ProblemError } from "../lib/problem.js";
import { parseBody } from "../lib/validate.js";
import { requireHuman, requireUser } from "./plugin.js";
import {
  API_KEY_SCOPES,
  clearSessionCookie,
  newApiKey,
  sessionCookie,
  signSession,
} from "./session.js";

export interface AuthRouteOptions {
  db: PrismaClient;
  sessionSecret: string;
  secureCookies: boolean;
}

/** Demo login (seeded demo users only), session info, and agent API keys. */
export async function authRoutes(app: FastifyInstance, o: AuthRouteOptions) {
  app.get("/auth/demo-users", async () => {
    const users = await o.db.user.findMany({
      where: { isDemo: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, displayName: true, isAgent: true, spendPolicy: { select: { id: true } } },
    });
    return {
      users: users.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        role: u.spendPolicy ? "buyer" : "seller",
      })),
    };
  });

  app.post("/auth/demo-login", async (req, reply) => {
    const { userId } = parseBody(z.object({ userId: z.string().min(1).max(64) }), req.body);
    const user = await o.db.user.findUnique({ where: { id: userId } });
    if (!user || !user.isDemo) throw new ProblemError(404, "not-found", "Demo user not found");
    const token = signSession(
      { uid: user.id, iat: Math.floor(Date.now() / 1000) },
      o.sessionSecret,
    );
    reply.header("set-cookie", sessionCookie(token, o.secureCookies));
    return { id: user.id, displayName: user.displayName };
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.header("set-cookie", clearSessionCookie(o.secureCookies));
    return { ok: true };
  });

  app.get("/auth/me", async (req) => {
    const p = requireUser(req);
    const policy = await o.db.spendPolicy.findUnique({ where: { userId: p.user.id } });
    return {
      id: p.user.id,
      displayName: p.user.displayName,
      via: p.via,
      role: policy ? "buyer" : "seller",
    };
  });

  app.post("/users/:id/api-keys", async (req, reply) => {
    const p = requireHuman(req);
    const { id } = parseBody(z.object({ id: z.string() }), req.params);
    if (id !== p.user.id) throw new ProblemError(403, "forbidden", "Only for your own account");
    const { scopes } = parseBody(
      z.object({ scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(2) }),
      req.body,
    );
    const { key, hash } = newApiKey();
    const row = await o.db.apiKey.create({ data: { userId: id, keyHash: hash, scopes } });
    // Shown once; only the hash is stored.
    return reply.status(201).send({ id: row.id, key, scopes });
  });
}
