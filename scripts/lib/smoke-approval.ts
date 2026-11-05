import path from "node:path";
import type { ApprovalRequest, SettlementApproval } from "../../apps/api/src/paypal/approval.js";
import { ApprovalError } from "../../apps/api/src/paypal/approval.js";

/**
 * Approval for CLI smoke scripts only (decision A). It stands in for a
 * persisted PolicyDecision so the scripts can exercise capture, payout and
 * refund against the sandbox.
 *
 * Refuses unless PAYPAL_ENV=sandbox, NODE_ENV is not production, and the
 * running entry point is a file under scripts/. A static test asserts this
 * module is imported only from scripts/.
 */
export class SmokeApproval implements SettlementApproval {
  readonly id = "smoke";

  constructor(private readonly scriptsDir = path.resolve(import.meta.dirname, "..")) {}

  async assertApproves(req: ApprovalRequest): Promise<void> {
    if (process.env.PAYPAL_ENV !== "sandbox") {
      throw new ApprovalError("SmokeApproval requires PAYPAL_ENV=sandbox");
    }
    if (process.env.NODE_ENV === "production") {
      throw new ApprovalError("SmokeApproval is never valid in production");
    }
    const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
    if (!entry.startsWith(this.scriptsDir + path.sep)) {
      throw new ApprovalError("SmokeApproval may only be used by a CLI script under scripts/");
    }
    if (!req.dealId.startsWith("smoke")) {
      throw new ApprovalError("SmokeApproval only approves smoke-test deal ids");
    }
  }
}
