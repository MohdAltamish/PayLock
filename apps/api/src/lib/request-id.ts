import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

// Accept a caller-supplied id only if it is short and safe to echo into logs and headers.
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function genRequestId(req: IncomingMessage): string {
  const incoming = req.headers["x-request-id"];
  if (typeof incoming === "string" && SAFE_ID.test(incoming)) return incoming;
  return randomUUID();
}
