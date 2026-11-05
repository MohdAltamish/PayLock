import type { LoggerOptions } from "pino";

/**
 * Pino redaction (invariants 7 and 10). Secrets, tokens and PII never reach logs.
 * Paths cover Fastify request logs and our own structured fields.
 */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-agent-key"]',
  'res.headers["set-cookie"]',
  "authorization",
  "access_token",
  "accessToken",
  "client_secret",
  "clientSecret",
  "token",
  "password",
  "email",
  "email_address",
  "receiver",
  "*.authorization",
  "*.access_token",
  "*.accessToken",
  "*.client_secret",
  "*.clientSecret",
  "*.token",
  "*.password",
  "*.email",
  "*.email_address",
  "*.receiver",
  "*.payoutEmail",
  "*.paypalEmail",
];

export function loggerOptions(level: string, pretty: boolean): LoggerOptions {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    base: { service: "paylock-api" },
    ...(pretty ? { transport: { target: "pino-pretty", options: { singleLine: true } } } : {}),
  };
}
