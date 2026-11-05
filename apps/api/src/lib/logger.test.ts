import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { loggerOptions } from "./logger.js";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { log: pino(loggerOptions("info", false), stream), lines };
}

describe("logger redaction", () => {
  it("redacts tokens, secrets, auth headers and emails", () => {
    const { log, lines } = capture();
    log.info(
      {
        req: { headers: { authorization: "Bearer A21AA-secret", cookie: "sid=abc" } },
        access_token: "A21AA-token",
        paypal: { client_secret: "s3cr3t", email: "buyer@example.com" },
        payout: { receiver: "seller@example.com" },
      },
      "test",
    );
    const out = lines.join("");
    for (const leaked of [
      "A21AA-secret",
      "A21AA-token",
      "s3cr3t",
      "buyer@example.com",
      "seller@example.com",
      "sid=abc",
    ]) {
      expect(out).not.toContain(leaked);
    }
    expect(out).toContain("[REDACTED]");
  });
});
