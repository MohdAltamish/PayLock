import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SmokeApproval } from "./smoke-approval.js";

const scriptsDir = path.resolve(import.meta.dirname, "..");
const req = { dealId: "smoke123", action: "capture" as const, amount: "1.00" };
const saved = { env: { ...process.env }, argv: [...process.argv] };

afterEach(() => {
  process.env = { ...saved.env };
  process.argv = [...saved.argv];
});

function asScript() {
  process.env.PAYPAL_ENV = "sandbox";
  process.env.NODE_ENV = "development";
  process.argv[1] = path.join(scriptsDir, "paypal-smoke.ts");
}

describe("SmokeApproval", () => {
  it("approves a smoke deal from a script in sandbox", async () => {
    asScript();
    await expect(new SmokeApproval().assertApproves(req)).resolves.toBeUndefined();
  });

  it("refuses outside sandbox", async () => {
    asScript();
    process.env.PAYPAL_ENV = "live";
    await expect(new SmokeApproval().assertApproves(req)).rejects.toThrow(/sandbox/);
  });

  it("refuses in production", async () => {
    asScript();
    process.env.NODE_ENV = "production";
    await expect(new SmokeApproval().assertApproves(req)).rejects.toThrow(/production/);
  });

  it("refuses when the entry point is not under scripts/", async () => {
    asScript();
    process.argv[1] = path.resolve(scriptsDir, "../apps/api/dist/server.js");
    await expect(new SmokeApproval().assertApproves(req)).rejects.toThrow(/scripts/);
  });

  it("refuses a lookalike directory such as scripts-evil/", async () => {
    asScript();
    process.argv[1] = `${scriptsDir}-evil/x.ts`;
    await expect(new SmokeApproval().assertApproves(req)).rejects.toThrow(/scripts/);
  });

  it("refuses non-smoke deal ids", async () => {
    asScript();
    await expect(
      new SmokeApproval().assertApproves({ ...req, dealId: "deal_real" }),
    ).rejects.toThrow(/smoke/);
  });
});
