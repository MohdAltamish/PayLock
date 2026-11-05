import { compareMoney } from "@paylock/schemas";
import { describe, expect, it } from "vitest";
import { captureAmount, releasePercent } from "./math.js";

describe("releasePercent", () => {
  it("PASS releases 100%", () => expect(releasePercent("PASS", 92, 70)).toBe(100));
  it("PARTIAL at or above partialPayMin releases the score", () => {
    expect(releasePercent("PARTIAL", 70, 70)).toBe(70);
    expect(releasePercent("PARTIAL", 85, 70)).toBe(85);
  });
  it("PARTIAL below partialPayMin is a FAIL", () =>
    expect(releasePercent("PARTIAL", 69, 70)).toBeNull());
  it("FAIL releases nothing", () => expect(releasePercent("FAIL", 95, 70)).toBeNull());
  it("rejects out-of-range inputs", () => {
    expect(() => releasePercent("PASS", 101, 70)).toThrow(RangeError);
    expect(() => releasePercent("PASS", 50.5, 70)).toThrow(RangeError);
    expect(() => releasePercent("PASS", 50, -1)).toThrow(RangeError);
  });
});

describe("captureAmount", () => {
  it("full", () => expect(captureAmount("300.00", 100)).toBe("300.00"));
  it("partial rounds down to cents", () => {
    expect(captureAmount("100.00", 70)).toBe("70.00");
    expect(captureAmount("33.33", 70)).toBe("23.33"); // 23.331
    expect(captureAmount("0.99", 85)).toBe("0.84"); // 0.8415
  });
  it("never exceeds the authorization", () => {
    for (const p of [1, 33, 50, 67, 99, 100]) {
      const a = captureAmount("123.45", p);
      expect(compareMoney(a, "123.45")).toBeLessThanOrEqual(0);
    }
  });
});
