import { readFileSync } from "node:fs";
import path from "node:path";
import { DEAL_STATES, TERMINAL_STATES, type DealState } from "@paylock/schemas";
import { describe, expect, it } from "vitest";
import {
  can,
  transition,
  TransitionError,
  type DealContext,
  type DealEvent,
  type DealEventType,
} from "./state-machine.js";

/** A context in which every guard passes; tests flip one field at a time. */
const OK: DealContext = {
  requiresHumanRelease: false,
  blockReason: null,
  hasPaypalAuth: true,
  authValid: true,
  hasDecision: true,
};
const ctx = (over: Partial<DealContext> = {}): DealContext => ({ ...OK, ...over });

const VOIDABLE: DealState[] = [
  "LOCKED",
  "DELIVERED",
  "VERIFYING",
  "NEEDS_REVIEW",
  "SETTLEMENT_ERROR",
];

/**
 * One canonical payload per event type, with the exact set of states that
 * accept it (under the all-guards-pass context) and the resulting state.
 * Every (state, event) pair not listed here must be rejected.
 */
const TABLE: Array<{ event: DealEvent; from: DealState[]; to: DealState | "same" }> = [
  { event: { type: "contract.created" }, from: ["DRAFT"], to: "CONTRACTED" },
  {
    event: { type: "risk.assessed", level: "LOW", policy: "allow" },
    from: ["CONTRACTED"],
    to: "GUARDED",
  },
  {
    event: { type: "buyer.override", reason: "I know them" },
    from: ["FLAGGED"],
    to: "AWAITING_APPROVAL",
  },
  { event: { type: "buyer.approve" }, from: ["AWAITING_APPROVAL"], to: "GUARDED" },
  { event: { type: "buyer.reject" }, from: ["AWAITING_APPROVAL"], to: "CANCELLED" },
  {
    event: { type: "buyer.cancel" },
    from: ["DRAFT", "CONTRACTED", "GUARDED", "FLAGGED", "AWAITING_APPROVAL", "FUNDING"],
    to: "CANCELLED",
  },
  {
    event: { type: "paypal.order.created", policyAllowed: true },
    from: ["GUARDED"],
    to: "FUNDING",
  },
  {
    event: { type: "paypal.authorization.created", verified: true },
    from: ["FUNDING"],
    to: "LOCKED",
  },
  {
    event: { type: "funding.failed", reason: "AUTH_DECLINED" },
    from: ["FUNDING"],
    to: "CANCELLED",
  },
  { event: { type: "seller.deliverable.submitted" }, from: ["LOCKED"], to: "DELIVERED" },
  { event: { type: "verifier.started" }, from: ["DELIVERED"], to: "VERIFYING" },
  {
    event: {
      type: "verifier.decided",
      outcome: "PASS",
      score: 100,
      partialPayMin: 70,
      needsHumanReview: false,
    },
    from: ["VERIFYING"],
    to: "RELEASING",
  },
  { event: { type: "verifier.invalid" }, from: ["VERIFYING"], to: "NEEDS_REVIEW" },
  {
    event: { type: "settlement.voided", reason: "VERIFICATION_FAILED" },
    from: VOIDABLE,
    to: "VOIDED",
  },
  {
    event: { type: "authorization.expired" },
    from: ["LOCKED", "DELIVERED", "VERIFYING", "NEEDS_REVIEW"],
    to: "VOIDED",
  },
  { event: { type: "human.approve" }, from: ["NEEDS_REVIEW"], to: "RELEASING" },
  { event: { type: "human.reject" }, from: ["NEEDS_REVIEW"], to: "same" },
  { event: { type: "settlement.released", partial: false }, from: ["RELEASING"], to: "RELEASED" },
  {
    event: { type: "settlement.failed", step: "capture" },
    from: ["RELEASING"],
    to: "SETTLEMENT_ERROR",
  },
  { event: { type: "human.retry", step: "capture" }, from: ["SETTLEMENT_ERROR"], to: "RELEASING" },
];

const ALL_EVENT_TYPES: DealEventType[] = [
  "contract.created",
  "risk.assessed",
  "buyer.override",
  "buyer.approve",
  "buyer.reject",
  "buyer.cancel",
  "paypal.order.created",
  "paypal.authorization.created",
  "funding.failed",
  "seller.deliverable.submitted",
  "verifier.started",
  "verifier.decided",
  "verifier.invalid",
  "settlement.voided",
  "authorization.expired",
  "human.approve",
  "human.reject",
  "settlement.released",
  "settlement.failed",
  "human.retry",
];

describe("state machine: exhaustive allowed and rejected transitions", () => {
  it("the table covers every event type exactly once", () => {
    expect(TABLE.map((r) => r.event.type).sort()).toEqual([...ALL_EVENT_TYPES].sort());
  });

  for (const row of TABLE) {
    for (const from of DEAL_STATES) {
      const accepted = row.from.includes(from);
      const expected = row.to === "same" ? from : row.to;
      it(`${row.event.type} in ${from} is ${accepted ? `accepted -> ${expected}` : "rejected"}`, () => {
        if (accepted) {
          expect(transition(from, row.event, OK).to).toBe(expected);
        } else {
          expect(() => transition(from, row.event, OK)).toThrow(TransitionError);
          expect(can(from, row.event, OK)).toBe(false);
        }
      });
    }
  }

  it("terminal states accept nothing", () => {
    for (const from of TERMINAL_STATES) {
      for (const row of TABLE) expect(can(from, row.event, OK)).toBe(false);
    }
  });

  it("TransitionError names the state, event and reason", () => {
    try {
      transition("RELEASED", { type: "buyer.cancel" }, OK);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TransitionError);
      const err = e as TransitionError;
      expect(err.from).toBe("RELEASED");
      expect(err.event).toBe("buyer.cancel");
      expect(err.message).toMatch(/allowed only from/);
    }
  });
});

describe("state machine: risk gating", () => {
  const assess = (
    level: "LOW" | "MEDIUM" | "HIGH",
    policy: "allow" | "require_approval" | "block",
    policyCap?: boolean,
  ) => transition("CONTRACTED", { type: "risk.assessed", level, policy, policyCap }, OK);

  it("LOW and allow -> GUARDED", () => expect(assess("LOW", "allow").to).toBe("GUARDED"));
  it("MEDIUM with allowMediumRisk (policy allow) -> GUARDED", () =>
    expect(assess("MEDIUM", "allow").to).toBe("GUARDED"));
  it("MEDIUM or over threshold (policy require_approval) -> AWAITING_APPROVAL", () => {
    expect(assess("MEDIUM", "require_approval").to).toBe("AWAITING_APPROVAL");
    expect(assess("LOW", "require_approval").to).toBe("AWAITING_APPROVAL");
  });
  it("HIGH -> FLAGGED even if the policy said allow", () =>
    expect(assess("HIGH", "allow").to).toBe("FLAGGED"));
  it("policy block -> FLAGGED", () => expect(assess("LOW", "block").to).toBe("FLAGGED"));
  it("policy cap -> FLAGGED with blockReason POLICY_CAP", () => {
    const r = assess("LOW", "block", true);
    expect(r).toEqual({ to: "FLAGGED", set: { blockReason: "POLICY_CAP" } });
  });
});

describe("state machine: guards", () => {
  it("override needs a reason and sets requiresHumanRelease", () => {
    expect(() => transition("FLAGGED", { type: "buyer.override", reason: "" }, OK)).toThrow(
      /needs a reason/,
    );
    expect(() => transition("FLAGGED", { type: "buyer.override", reason: "  " }, OK)).toThrow(
      TransitionError,
    );
    expect(transition("FLAGGED", { type: "buyer.override", reason: "known vendor" }, OK)).toEqual({
      to: "AWAITING_APPROVAL",
      set: { requiresHumanRelease: true },
    });
  });

  it("a POLICY_CAP block cannot be overridden; cancel is the only exit", () => {
    const capped = ctx({ blockReason: "POLICY_CAP" });
    expect(() =>
      transition("FLAGGED", { type: "buyer.override", reason: "please" }, capped),
    ).toThrow(/cannot be overridden/);
    expect(transition("FLAGGED", { type: "buyer.cancel" }, capped).to).toBe("CANCELLED");
  });

  it("FUNDING requires a policy ALLOW", () => {
    expect(() =>
      transition("GUARDED", { type: "paypal.order.created", policyAllowed: false }, OK),
    ).toThrow(/policy ALLOW/);
  });

  it("LOCKED requires a verified authorization", () => {
    expect(() =>
      transition("FUNDING", { type: "paypal.authorization.created", verified: false }, OK),
    ).toThrow(/match the stored order/);
  });

  it.each(["AUTH_DECLINED", "ORDER_MISMATCH", "POLICY_CAP", "FUNDING_TIMEOUT"] as const)(
    "funding failure %s -> CANCELLED with that reason",
    (reason) => {
      expect(transition("FUNDING", { type: "funding.failed", reason }, OK)).toEqual({
        to: "CANCELLED",
        set: { blockReason: reason },
      });
    },
  );

  it("cancel and reject record BUYER_CANCELLED", () => {
    expect(transition("GUARDED", { type: "buyer.cancel" }, OK).set).toEqual({
      blockReason: "BUYER_CANCELLED",
    });
    expect(transition("AWAITING_APPROVAL", { type: "buyer.reject" }, OK).set).toEqual({
      blockReason: "BUYER_CANCELLED",
    });
  });
});

describe("state machine: verifier outcomes", () => {
  const decided = (
    outcome: "PASS" | "PARTIAL" | "FAIL",
    score: number,
    needsHumanReview = false,
    c: DealContext = OK,
  ) =>
    transition(
      "VERIFYING",
      { type: "verifier.decided", outcome, score, partialPayMin: 70, needsHumanReview },
      c,
    ).to;

  it("PASS -> RELEASING", () => expect(decided("PASS", 100)).toBe("RELEASING"));
  it("PARTIAL at partialPayMin -> RELEASING", () =>
    expect(decided("PARTIAL", 70)).toBe("RELEASING"));
  it("PARTIAL below partialPayMin stays VERIFYING for the void", () =>
    expect(decided("PARTIAL", 69)).toBe("VERIFYING"));
  it("FAIL stays VERIFYING; settlement voids it", () => {
    expect(decided("FAIL", 45)).toBe("VERIFYING");
    expect(
      transition("VERIFYING", { type: "settlement.voided", reason: "VERIFICATION_FAILED" }, OK),
    ).toEqual({ to: "VOIDED", set: { blockReason: "VERIFICATION_FAILED" } });
  });
  it("needsHumanReview -> NEEDS_REVIEW", () =>
    expect(decided("PASS", 100, true)).toBe("NEEDS_REVIEW"));
  it("a FAIL that needs human review -> NEEDS_REVIEW, not a void", () =>
    expect(decided("FAIL", 40, true)).toBe("NEEDS_REVIEW"));
  it("an overridden deal that FAILs is voided (override only gates release)", () =>
    expect(decided("FAIL", 40, false, ctx({ requiresHumanRelease: true }))).toBe("VERIFYING"));
  it("an overridden deal (requiresHumanRelease) -> NEEDS_REVIEW", () =>
    expect(decided("PASS", 100, false, ctx({ requiresHumanRelease: true }))).toBe("NEEDS_REVIEW"));
  it("review routing does not need an authorization check (no money moves)", () =>
    expect(decided("PASS", 100, true, ctx({ authValid: false }))).toBe("NEEDS_REVIEW"));
  it("release needs a persisted Decision", () =>
    expect(() => decided("PASS", 100, false, ctx({ hasDecision: false }))).toThrow(/Decision/));
  it("release needs an authorization", () =>
    expect(() => decided("PASS", 100, false, ctx({ hasPaypalAuth: false }))).toThrow(
      /authorization/,
    ));
  it("release needs an unexpired authorization", () =>
    expect(() => decided("PASS", 100, false, ctx({ authValid: false }))).toThrow(/unexpired/));
});

describe("state machine: human review", () => {
  it("approve needs a Decision and a valid authorization", () => {
    expect(() =>
      transition("NEEDS_REVIEW", { type: "human.approve" }, ctx({ hasDecision: false })),
    ).toThrow(/Decision/);
    expect(() =>
      transition("NEEDS_REVIEW", { type: "human.approve" }, ctx({ authValid: false })),
    ).toThrow(/unexpired/);
  });
  it("reject stays NEEDS_REVIEW until settlement records the void", () => {
    expect(transition("NEEDS_REVIEW", { type: "human.reject" }, OK).to).toBe("NEEDS_REVIEW");
    expect(
      transition("NEEDS_REVIEW", { type: "settlement.voided", reason: "HUMAN_REJECTED" }, OK).to,
    ).toBe("VOIDED");
  });
});

describe("state machine: settlement and SETTLEMENT_ERROR", () => {
  it("partial release -> RELEASED_PARTIAL", () => {
    expect(transition("RELEASING", { type: "settlement.released", partial: true }, OK).to).toBe(
      "RELEASED_PARTIAL",
    );
  });

  it("capture or payout failure -> SETTLEMENT_ERROR, only from RELEASING", () => {
    for (const step of ["capture", "payout"] as const) {
      expect(transition("RELEASING", { type: "settlement.failed", step }, OK).to).toBe(
        "SETTLEMENT_ERROR",
      );
      expect(can("VERIFYING", { type: "settlement.failed", step }, OK)).toBe(false);
    }
  });

  it("void failure -> SETTLEMENT_ERROR from every state holding an authorization", () => {
    for (const s of DEAL_STATES) {
      const ok = can(s, { type: "settlement.failed", step: "void" }, OK);
      expect(ok).toBe(VOIDABLE.includes(s));
    }
  });

  it("refund failure stays in SETTLEMENT_ERROR and is accepted nowhere else", () => {
    for (const s of DEAL_STATES) {
      const ok = can(s, { type: "settlement.failed", step: "refund" }, OK);
      expect(ok).toBe(s === "SETTLEMENT_ERROR");
    }
  });

  it("refund success -> VOIDED with REFUNDED, only from SETTLEMENT_ERROR", () => {
    expect(
      transition("SETTLEMENT_ERROR", { type: "settlement.voided", reason: "REFUNDED" }, OK),
    ).toEqual({ to: "VOIDED", set: { blockReason: "REFUNDED" } });
    expect(can("LOCKED", { type: "settlement.voided", reason: "REFUNDED" }, OK)).toBe(false);
  });

  it("retry of a release step -> RELEASING; retry of a void stays until the void lands", () => {
    expect(transition("SETTLEMENT_ERROR", { type: "human.retry", step: "payout" }, OK).to).toBe(
      "RELEASING",
    );
    expect(transition("SETTLEMENT_ERROR", { type: "human.retry", step: "void" }, OK).to).toBe(
      "SETTLEMENT_ERROR",
    );
  });

  it("capture retry needs an unexpired authorization; payout retry does not", () => {
    const expired = ctx({ authValid: false });
    expect(() =>
      transition("SETTLEMENT_ERROR", { type: "human.retry", step: "capture" }, expired),
    ).toThrow(/unexpired/);
    // The capture already happened; the authorization is CAPTURED, not "valid".
    expect(
      transition("SETTLEMENT_ERROR", { type: "human.retry", step: "payout" }, expired).to,
    ).toBe("RELEASING");
  });

  it("release retry needs an authorization and a Decision", () => {
    expect(() =>
      transition(
        "SETTLEMENT_ERROR",
        { type: "human.retry", step: "payout" },
        ctx({ hasPaypalAuth: false }),
      ),
    ).toThrow(/authorization/);
    expect(() =>
      transition(
        "SETTLEMENT_ERROR",
        { type: "human.retry", step: "payout" },
        ctx({ hasDecision: false }),
      ),
    ).toThrow(/Decision/);
  });

  it("expiry sets AUTH_EXPIRED; a deadline void sets DEADLINE_PASSED", () => {
    expect(transition("LOCKED", { type: "authorization.expired" }, OK)).toEqual({
      to: "VOIDED",
      set: { blockReason: "AUTH_EXPIRED" },
    });
    expect(
      transition("LOCKED", { type: "settlement.voided", reason: "DEADLINE_PASSED" }, OK).set,
    ).toEqual({ blockReason: "DEADLINE_PASSED" });
  });
});

describe("state machine: reachability", () => {
  /** Every payload variant worth exploring, under every guard combination. */
  const VARIANTS: DealEvent[] = [
    ...TABLE.map((r) => r.event),
    { type: "risk.assessed", level: "MEDIUM", policy: "require_approval" },
    { type: "risk.assessed", level: "HIGH", policy: "block" },
    { type: "settlement.released", partial: true },
    { type: "settlement.failed", step: "void" },
    { type: "settlement.failed", step: "payout" },
    { type: "settlement.failed", step: "refund" },
    { type: "settlement.voided", reason: "REFUNDED" },
    { type: "human.retry", step: "void" },
  ];

  function edges(): Set<string> {
    const out = new Set<string>();
    for (const from of DEAL_STATES) {
      for (const ev of VARIANTS) {
        if (can(from, ev, OK)) {
          const to = transition(from, ev, OK).to;
          if (to !== from) out.add(`${from}->${to}`);
        }
      }
    }
    return out;
  }

  it("every state is reachable from DRAFT", () => {
    const e = [...edges()].map((s) => s.split("->") as [DealState, DealState]);
    const seen = new Set<DealState>(["DRAFT"]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [a, b] of e) {
        if (seen.has(a) && !seen.has(b)) {
          seen.add(b);
          grew = true;
        }
      }
    }
    expect([...seen].sort()).toEqual([...DEAL_STATES].sort());
  });

  it("matches the transition list in DESIGN.md section 3 exactly (docs stay in sync)", () => {
    const design = readFileSync(
      path.resolve(import.meta.dirname, "../../../../docs/DESIGN.md"),
      "utf8",
    );
    const section = design.split("## 3. State machine")[1]?.split("Guards:")[0] ?? "";
    const documented = new Set<string>();
    for (const line of section.split("\n")) {
      const m = /^([A-Z_ |]+?)\s*->\s*([A-Z_]+)\s*:/.exec(line.trim());
      if (!m) continue;
      for (const from of m[1]!.split("|").map((s) => s.trim())) documented.add(`${from}->${m[2]}`);
    }
    expect(documented.size).toBeGreaterThan(20);
    expect([...edges()].sort()).toEqual([...documented].sort());
  });
});
