import { describe, expect, it } from "vitest";
import {
  DAILY_CAP_STATES,
  evaluateAuthorize,
  evaluateCapture,
  evaluateFund,
  evaluateGuard,
  evaluatePayout,
  evaluateRefund,
  evaluateVoid,
  guardPolicy,
  startOfUtcDay,
  type SpendPolicyInput,
} from "./engine.js";

// Decision M seed values.
const POLICY: SpendPolicyInput = {
  maxPerDeal: "1000.00",
  dailyCap: "3000.00",
  approvalThreshold: "500.00",
  allowMediumRisk: false,
};

describe("evaluateGuard", () => {
  const g = (
    level: "LOW" | "MEDIUM" | "HIGH",
    amount = "300.00",
    committedToday = "0.00",
    policy = POLICY,
  ) => evaluateGuard({ level, amount, policy, committedToday });

  it("LOW within threshold -> ALLOW", () => {
    const o = g("LOW");
    expect(o).toMatchObject({ result: "ALLOW", reasons: ["WITHIN_POLICY"], policyCap: false });
    expect(guardPolicy(o)).toBe("allow");
  });

  it("amount exactly at threshold -> ALLOW; one cent over -> REQUIRE_APPROVAL", () => {
    expect(g("LOW", "500.00").result).toBe("ALLOW");
    const over = g("LOW", "500.01");
    expect(over).toMatchObject({ result: "REQUIRE_APPROVAL", reasons: ["AMOUNT_OVER_THRESHOLD"] });
    expect(guardPolicy(over)).toBe("require_approval");
  });

  it("MEDIUM -> REQUIRE_APPROVAL by default", () => {
    expect(g("MEDIUM")).toMatchObject({ result: "REQUIRE_APPROVAL", reasons: ["RISK_MEDIUM"] });
  });

  it("MEDIUM with allowMediumRisk -> ALLOW, and the signal is still logged", () => {
    const o = g("MEDIUM", "300.00", "0.00", { ...POLICY, allowMediumRisk: true });
    expect(o).toMatchObject({ result: "ALLOW", reasons: ["RISK_MEDIUM_ALLOWED_BY_POLICY"] });
  });

  it("MEDIUM allowed but over threshold still needs approval", () => {
    const o = g("MEDIUM", "600.00", "0.00", { ...POLICY, allowMediumRisk: true });
    expect(o.result).toBe("REQUIRE_APPROVAL");
    expect(o.reasons).toEqual(["RISK_MEDIUM_ALLOWED_BY_POLICY", "AMOUNT_OVER_THRESHOLD"]);
  });

  it("HIGH -> BLOCK, not a policy cap (overridable)", () => {
    const o = g("HIGH");
    expect(o).toMatchObject({ result: "BLOCK", reasons: ["RISK_HIGH"], policyCap: false });
    expect(guardPolicy(o)).toBe("block");
  });

  it("over maxPerDeal -> BLOCK with policyCap, even for LOW risk", () => {
    expect(g("LOW", "1000.01")).toMatchObject({
      result: "BLOCK",
      reasons: ["AMOUNT_OVER_MAX_PER_DEAL"],
      policyCap: true,
    });
  });

  it("daily cap: committed + amount over the cap -> BLOCK with policyCap", () => {
    expect(g("LOW", "300.00", "2700.00").result).toBe("ALLOW");
    expect(g("LOW", "300.01", "2700.00")).toMatchObject({
      result: "BLOCK",
      reasons: ["DAILY_CAP_EXCEEDED"],
      policyCap: true,
    });
  });

  it("caps win over risk: HIGH and over cap reports the cap", () => {
    expect(g("HIGH", "2000.00").reasons).toEqual(["AMOUNT_OVER_MAX_PER_DEAL"]);
  });

  it("records its inputs", () => {
    expect(g("LOW").inputs).toMatchObject({
      level: "LOW",
      amount: "300.00",
      committedToday: "0.00",
    });
  });
});

describe("evaluateFund and evaluateAuthorize", () => {
  const base = { amount: "300.00", policy: POLICY, committedToday: "0.00" };
  it("fund ALLOW from GUARDED", () =>
    expect(evaluateFund({ ...base, state: "GUARDED", freeze: false }).result).toBe("ALLOW"));
  it("fund BLOCK when frozen", () =>
    expect(evaluateFund({ ...base, state: "GUARDED", freeze: true }).reasons).toEqual(["FROZEN"]));
  it("fund BLOCK outside GUARDED", () =>
    expect(evaluateFund({ ...base, state: "FLAGGED", freeze: false }).reasons).toEqual([
      "INVALID_STATE",
    ]));
  it("fund re-checks caps", () =>
    expect(
      evaluateFund({ ...base, committedToday: "2800.00", state: "GUARDED", freeze: false }),
    ).toMatchObject({ result: "BLOCK", policyCap: true }));
  it("authorize re-checks the daily cap (decision D)", () => {
    expect(evaluateAuthorize({ ...base, freeze: false }).result).toBe("ALLOW");
    expect(evaluateAuthorize({ ...base, committedToday: "2700.01", freeze: false })).toMatchObject({
      result: "BLOCK",
      reasons: ["DAILY_CAP_EXCEEDED"],
      policyCap: true,
    });
    expect(evaluateAuthorize({ ...base, freeze: true }).reasons).toEqual(["FROZEN"]);
  });
});

describe("evaluateCapture", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  const ok = {
    freeze: false,
    amount: "100.00",
    decision: { id: "dec1", outcome: "PASS" as const },
    humanApproved: false,
    requiresHumanRelease: false,
    authExpiresAt: new Date("2026-11-06T12:00:00Z"),
    now,
  };
  it("ALLOW with a PASS decision and a valid authorization", () => {
    expect(evaluateCapture(ok)).toMatchObject({ result: "ALLOW", action: "capture" });
    expect(evaluateCapture(ok).inputs).toMatchObject({ amount: "100.00", decisionId: "dec1" });
  });
  it.each([
    ["NO_DECISION", { decision: null }],
    ["FROZEN", { freeze: true }],
    ["AUTH_EXPIRED", { authExpiresAt: now }],
    ["AUTH_EXPIRED", { authExpiresAt: null }],
    ["HUMAN_RELEASE_REQUIRED", { requiresHumanRelease: true }],
    ["DECISION_FAIL", { decision: { id: "d", outcome: "FAIL" as const } }],
    ["ZERO_AMOUNT", { amount: "0.00" }],
  ])("BLOCK %s", (reason, over) => {
    const o = evaluateCapture({ ...ok, ...over });
    expect(o.result).toBe("BLOCK");
    expect(o.reasons).toContain(reason);
  });
  it("a human approval satisfies requiresHumanRelease and overrides a FAIL", () => {
    expect(
      evaluateCapture({
        ...ok,
        requiresHumanRelease: true,
        humanApproved: true,
        decision: { id: "d", outcome: "FAIL" },
      }).result,
    ).toBe("ALLOW");
  });
});

describe("evaluatePayout, evaluateVoid, evaluateRefund", () => {
  const completed = { status: "COMPLETED", amount: "70.00" };
  it("payout only after a COMPLETED capture, for the captured gross", () => {
    expect(evaluatePayout({ freeze: false, amount: "70.00", capture: completed }).result).toBe(
      "ALLOW",
    );
    expect(
      evaluatePayout({
        freeze: false,
        amount: "70.00",
        capture: { ...completed, status: "PENDING" },
      }).reasons,
    ).toEqual(["CAPTURE_NOT_COMPLETED"]);
    expect(evaluatePayout({ freeze: false, amount: "70.00", capture: null }).result).toBe("BLOCK");
    expect(evaluatePayout({ freeze: false, amount: "69.99", capture: completed }).reasons).toEqual([
      "AMOUNT_NOT_CAPTURED_GROSS",
    ]);
    expect(evaluatePayout({ freeze: true, amount: "70.00", capture: completed }).reasons).toEqual([
      "FROZEN",
    ]);
  });
  it("void is allowed during a freeze (decision C)", () => {
    expect(evaluateVoid({ freeze: true, reason: "VERIFICATION_FAILED" })).toMatchObject({
      result: "ALLOW",
      reasons: ["VOID_ALLOWED_DURING_FREEZE", "VERIFICATION_FAILED"],
    });
  });
  it("refund needs a completed capture and a terminally failed payout", () => {
    const base = { freeze: false, amount: "70.00", capture: completed };
    expect(evaluateRefund({ ...base, payoutTerminallyFailed: true }).result).toBe("ALLOW");
    expect(evaluateRefund({ ...base, payoutTerminallyFailed: false }).reasons).toEqual([
      "PAYOUT_NOT_TERMINALLY_FAILED",
    ]);
    expect(evaluateRefund({ ...base, freeze: true, payoutTerminallyFailed: true }).reasons).toEqual(
      ["FROZEN"],
    );
  });
});

describe("daily cap helpers", () => {
  it("counts the amended decision D states only", () => {
    expect([...DAILY_CAP_STATES].sort()).toEqual(
      [
        "DELIVERED",
        "LOCKED",
        "NEEDS_REVIEW",
        "RELEASED",
        "RELEASED_PARTIAL",
        "RELEASING",
        "SETTLEMENT_ERROR",
        "VERIFYING",
      ].sort(),
    );
    expect(DAILY_CAP_STATES).not.toContain("FUNDING");
    expect(DAILY_CAP_STATES).not.toContain("VOIDED");
  });
  it("startOfUtcDay", () => {
    expect(startOfUtcDay(new Date("2026-11-05T23:59:59.999-05:00")).toISOString()).toBe(
      "2026-11-06T00:00:00.000Z",
    );
  });
});
