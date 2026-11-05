import Decimal from "decimal.js";
import { z } from "zod";

/**
 * Money handling (invariant 9).
 *
 * - On the wire and in agent outputs, money is a Decimal string with exactly
 *   two fraction digits, e.g. "300.00". Never a JS number.
 * - In code, money is a decimal.js `Decimal`. Never a float.
 * - Currency is explicit and, for the demo, USD only.
 *
 * DB columns are Decimal(12,2), so at most 10 integer digits.
 */

export const MONEY_PATTERN = /^\d{1,10}\.\d{2}$/;

/** A non-negative money string like "0.00" or "300.00". */
export const Money = z
  .string()
  .regex(MONEY_PATTERN, "Money must be a decimal string with two fraction digits, e.g. 300.00");
export type Money = z.infer<typeof Money>;

/** A money string greater than zero. */
export const PositiveMoney = Money.refine((v) => new Decimal(v).gt(0), "Amount must be > 0.00");

export const Currency = z.literal("USD");
export type Currency = z.infer<typeof Currency>;

export const MoneyAmount = z.object({ value: PositiveMoney, currency: Currency });
export type MoneyAmount = z.infer<typeof MoneyAmount>;

// A dedicated Decimal constructor so rounding settings never leak into other code.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_DOWN });
export type Dec = InstanceType<typeof D>;

/** Parse a money string. Throws on anything that is not a valid money string. */
export function parseMoney(value: string): Dec {
  if (typeof value !== "string" || !MONEY_PATTERN.test(value)) {
    throw new TypeError(`Invalid money string: ${JSON.stringify(value)}`);
  }
  return new D(value);
}

/**
 * Convert a Decimal (or decimal-like string from the DB driver) to a money
 * string. Refuses values that are not already whole cents, so precision is
 * never silently lost; use `percentOf` or `roundDownToCents` for derived values.
 */
export function toMoney(value: Dec | Decimal | string): Money {
  const d = new D(value.toString());
  if (d.isNegative()) throw new RangeError(`Money cannot be negative: ${d.toString()}`);
  if (!d.mul(100).isInteger()) {
    throw new RangeError(`Money must be whole cents: ${d.toString()}`);
  }
  const s = d.toFixed(2);
  if (!MONEY_PATTERN.test(s)) throw new RangeError(`Money out of range: ${s}`);
  return s;
}

/** Round down to whole cents. Captures must never exceed what was authorized. */
export function roundDownToCents(value: Dec | Decimal | string): Dec {
  return new D(value.toString()).toDecimalPlaces(2, Decimal.ROUND_DOWN);
}

/** amount * percent / 100, rounded down to cents. `percent` is an integer 0-100. */
export function percentOf(amount: Money, percent: number): Money {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new RangeError(`percent must be an integer 0-100, got ${percent}`);
  }
  return toMoney(roundDownToCents(parseMoney(amount).mul(percent).div(100)));
}

export function addMoney(a: Money, b: Money): Money {
  return toMoney(parseMoney(a).add(parseMoney(b)));
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  return parseMoney(a).cmp(parseMoney(b)) as -1 | 0 | 1;
}

export function moneyEquals(a: Money, b: Money): boolean {
  return compareMoney(a, b) === 0;
}
