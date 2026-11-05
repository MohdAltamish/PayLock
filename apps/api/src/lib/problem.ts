import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** RFC 7807 problem details. Every error response uses this shape. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  request_id: string;
  [extension: string]: unknown;
}

const PROBLEM_BASE = "https://paylock.dev/problems/";

export class ProblemError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly title: string,
    public readonly detail?: string,
    public readonly extensions: Record<string, unknown> = {},
  ) {
    super(detail ?? title);
    this.name = "ProblemError";
  }
}

export function problemBody(
  req: FastifyRequest,
  status: number,
  code: string,
  title: string,
  detail?: string,
  extensions: Record<string, unknown> = {},
): Problem {
  return {
    type: `${PROBLEM_BASE}${code}`,
    title,
    status,
    ...(detail ? { detail } : {}),
    instance: req.url,
    request_id: req.id,
    ...extensions,
  };
}

function send(reply: FastifyReply, body: Problem) {
  return reply.status(body.status).type("application/problem+json").send(body);
}

export function registerProblemHandlers(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | ProblemError, req, reply) => {
    if (err instanceof ProblemError) {
      if (err.status >= 500) req.log.error({ err }, err.title);
      return send(
        reply,
        problemBody(req, err.status, err.code, err.title, err.detail, err.extensions),
      );
    }
    // Invalid deal transitions (deals/state-machine.ts) become 409 problems naming the state.
    if (err.name === "TransitionError") {
      const t = err as unknown as { from: string; event: string; reason: string };
      return send(
        reply,
        problemBody(req, 409, "invalid-transition", "That action is not allowed now", t.reason, {
          state: t.from,
          event: t.event,
        }),
      );
    }
    if (err.name === "DealNotFoundError") {
      return send(reply, problemBody(req, 404, "not-found", "Deal not found"));
    }
    if (err.validation) {
      return send(
        reply,
        problemBody(req, 400, "validation-error", "Request validation failed", err.message),
      );
    }
    const status =
      err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err }, "unhandled error");
      // Never leak internals in 5xx responses.
      return send(reply, problemBody(req, status, "internal-error", "Internal server error"));
    }
    return send(reply, problemBody(req, status, err.code ?? "client-error", err.message));
  });

  app.setNotFoundHandler((req, reply) =>
    send(
      reply,
      problemBody(req, 404, "not-found", "Not found", `No route for ${req.method} ${req.url}`),
    ),
  );
}
