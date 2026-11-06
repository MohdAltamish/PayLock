import { describe, expect, it } from "vitest";
import { getDealStep } from "../lib/wizard";

describe("wizard step mapping", () => {
  it("maps new or draft state to step 1 (Describe)", () => {
    expect(getDealStep(undefined)).toBe(1);
    expect(getDealStep(null)).toBe(1);
    expect(getDealStep("DRAFT")).toBe(1);
  });

  it("maps CONTRACTED to step 2 (Contract)", () => {
    expect(getDealStep("CONTRACTED")).toBe(2);
  });

  it("maps pre-funding states to step 3 (Guard & Fund)", () => {
    expect(getDealStep("GUARDED")).toBe(3);
    expect(getDealStep("FLAGGED")).toBe(3);
    expect(getDealStep("AWAITING_APPROVAL")).toBe(3);
    expect(getDealStep("FUNDING")).toBe(3);
  });

  it("returns null for funded and closed states", () => {
    expect(getDealStep("LOCKED")).toBeNull();
    expect(getDealStep("DELIVERED")).toBeNull();
    expect(getDealStep("VERIFYING")).toBeNull();
    expect(getDealStep("NEEDS_REVIEW")).toBeNull();
    expect(getDealStep("RELEASING")).toBeNull();
    expect(getDealStep("RELEASED")).toBeNull();
    expect(getDealStep("RELEASED_PARTIAL")).toBeNull();
    expect(getDealStep("CANCELLED")).toBeNull();
    expect(getDealStep("VOIDED")).toBeNull();
    expect(getDealStep("SETTLEMENT_ERROR")).toBeNull();
  });
});

