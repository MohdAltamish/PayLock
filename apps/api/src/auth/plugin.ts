import type { PrismaClient, User } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "../lib/fp.js";
import { ProblemError } from "../lib/problem.js";
import {
  hashApiKey,
  parseCookies,
  SESSION_COOKIE,
  verifySession,
  type ApiKeyScope,
} from "./session.js";

export interface Principal {
  user: User;
  /** cookie = human demo session; apiKey = agent with scopes. */
  via: "cookie" | "apiKey";
  scopes: ApiKeyScope[];
}

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

export interface AuthOptions {
  db: PrismaClient;
  sessionSecret: string;
  /** Origins allowed to send cookie-authenticated writes (CSRF check). */
  allowedOrigins: string[];
}

/**
 * Resolves the caller from the session cookie or X-Agent-Key. Cookie-based
 * writes must come from an allowed Origin when the browser sends one.
 */
export const authPlugin = fp(async (app: FastifyInstance, opts: AuthOptions) => {
  app.decorateRequest("principal", null);
  app.addHook("onRequest", async (req) => {
    req.principal = null;
    const agentKey = req.headers["x-agent-key"];
    if (typeof agentKey === "string" && agentKey.length > 0) {
      const key = await opts.db.apiKey.findUnique({
        where: { keyHash: hashApiKey(agentKey) },
        include: { user: true },
      });
      if (!key || key.revokedAt) throw new ProblemError(401, "invalid-api-key", "Invalid API key");
      req.principal = {
        user: key.user,
        via: "apiKey",
        scopes: key.scopes.filter((s): s is ApiKeyScope =>
          ["deals:write", "deliverables:write"].includes(s),
        ),
      };
      return;
    }
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const session = verifySession(token, opts.sessionSecret);
    if (!session) return;
    const user = await opts.db.user.findUnique({ where: { id: session.uid } });
    if (!user) return;
    req.principal = { user, via: "cookie", scopes: [] };
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      const origin = req.headers.origin;
      if (typeof origin === "string" && !opts.allowedOrigins.includes(origin)) {
        throw new ProblemError(403, "bad-origin", "Cross-origin request refused");
      }
    }
  });
});

/** Require any authenticated caller. */
export function requireUser(req: FastifyRequest): Principal {
  if (!req.principal) throw new ProblemError(401, "unauthenticated", "Sign in first");
  return req.principal;
}

/** Require a human session (approvals, overrides, retries and policy are never agent actions). */
export function requireHuman(req: FastifyRequest): Principal {
  const p = requireUser(req);
  if (p.via !== "cookie")
    throw new ProblemError(
      403,
      "human-only",
      "This action needs a signed-in person, not an agent key",
    );
  return p;
}

/** Require a human, or an agent key with the given scope. */
export function requireScope(req: FastifyRequest, scope: ApiKeyScope): Principal {
  const p = requireUser(req);
  if (p.via === "apiKey" && !p.scopes.includes(scope))
    throw new ProblemError(403, "missing-scope", `API key lacks scope ${scope}`);
  return p;
}
