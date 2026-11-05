import { describe, expect, it } from "vitest";
import {
  Currency,
  Money,
  PositiveMoney,
  addMoney,
  compareMoney,
  moneyEquals,
  parseMoney,
  percentOf,
  roundDownToCents,
  toMoney,
} from "./money.js";

describe("Money schema", () => {
  it.each(["0.00", "1.00", "300.00", "9999999999.99"])("accepts %s", (v) => {
    expect(Money.parse(v)).toBe(v);
  });

  it.each(["300", "300.0", "300.000", "-1.00", "1e3", " 1.00", "1,000.00", "", "12345678901.00"])(
    "rejects %j",
    (v) => {
      expect(Money.safeParse(v).success).toBe(false);
    },
  );

  it("rejects numbers, so floats can never enter through the schema", () => {
    expect(Money.safeParse(300).success).toBe(false);
    expect(Money.safeParse(0.1 + 0.2).success).toBe(false);
  });

  it("PositiveMoney rejects zero", () => {
    expect(PositiveMoney.safeParse("0.00").success).toBe(false);
    expect(PositiveMoney.safeParse("0.01").success).toBe(true);
  });

  it("currency is USD only", () => {
    expect(Currency.safeParse("USD").success).toBe(true);
    expect(Currency.safeParse("EUR").success).toBe(false);
    expect(Currency.safeParse("usd").success).toBe(false);
  });
});

describe("money math", () => {
  it("parse and format round-trip exactly", () => {
    expect(toMoney(parseMoney("0.10"))).toBe("0.10");
    expect(toMoney(parseMoney("123.45"))).toBe("123.45");
  });

  it("adds without float error", () => {
    expect(addMoney("0.10", "0.20")).toBe("0.30");
  });

  it("refuses to format sub-cent values instead of silently rounding", () => {
    expect(() => toMoney("1.005")).toThrow(RangeError);
    expect(() => toMoney("-1.00")).toThrow(RangeError);
  });

  it("parseMoney rejects malformed input", () => {
    expect(() => parseMoney("1.5")).toThrow(TypeError);
    expect(() => parseMoney(1 as unknown as string)).toThrow(TypeError);
  });

  it("percentOf rounds down to cents", () => {
    expect(percentOf("100.00", 70)).toBe("70.00");
    expect(percentOf("300.00", 85)).toBe("255.00");
    expect(percentOf("33.33", 70)).toBe("23.33"); // 23.331
    expect(percentOf("0.99", 50)).toBe("0.49"); // 0.495
    expect(percentOf("10.00", 0)).toBe("0.00");
    expect(percentOf("10.00", 100)).toBe("10.00");
  });

  it("percentOf rejects non-integer or out-of-range percent", () => {
    expect(() => percentOf("10.00", 70.5)).toThrow(RangeError);
    expect(() => percentOf("10.00", 101)).toThrow(RangeError);
    expect(() => percentOf("10.00", -1)).toThrow(RangeError);
  });

  it("roundDownToCents never rounds up", () => {
    expect(roundDownToCents("1.999").toFixed(2)).toBe("1.99");
  });

  it("compares", () => {
    expect(compareMoney("10.00", "9.99")).toBe(1);
    expect(compareMoney("9.99", "10.00")).toBe(-1);
    expect(moneyEquals("10.00", "10.00")).toBe(true);
  });
});
