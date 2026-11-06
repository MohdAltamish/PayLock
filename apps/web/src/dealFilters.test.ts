import { describe, expect, it } from "vitest";
import {
  filterDeals,
  getFilterCounts,
  isActive,
  isClosed,
  needsYou,
  type FilterableDeal,
} from "../lib/dealFilters";

const SAMPLE_DEALS: FilterableDeal[] = [
  { id: "1", state: "CONTRACTED", role: "buyer" },
  { id: "2", state: "LOCKED", role: "seller" },
  { id: "3", state: "LOCKED", role: "buyer" },
  { id: "4", state: "RELEASED", role: "buyer" },
  { id: "5", state: "CANCELLED", role: "seller" },
  { id: "6", state: "NEEDS_REVIEW", role: "buyer" },
  { id: "7", state: "SETTLEMENT_ERROR", role: "buyer" },
];

describe("dealFilters", () => {
  it("determines active vs closed deals correctly", () => {
    expect(isClosed("RELEASED")).toBe(true);
    expect(isClosed("CANCELLED")).toBe(true);
    expect(isClosed("VOIDED")).toBe(true);
    expect(isClosed("CONTRACTED")).toBe(false);
    expect(isClosed("LOCKED")).toBe(false);

    expect(isActive("LOCKED")).toBe(true);
    expect(isActive("RELEASED")).toBe(false);
  });

  it("identifies when deal needs buyer attention", () => {
    expect(needsYou({ state: "CONTRACTED", role: "buyer" })).toBe(true);
    expect(needsYou({ state: "NEEDS_REVIEW", role: "buyer" })).toBe(true);
    expect(needsYou({ state: "SETTLEMENT_ERROR", role: "buyer" })).toBe(true);
    expect(needsYou({ state: "LOCKED", role: "buyer" })).toBe(false);
  });

  it("identifies when deal needs seller attention", () => {
    expect(needsYou({ state: "LOCKED", role: "seller" })).toBe(true);
    expect(needsYou({ state: "CONTRACTED", role: "seller" })).toBe(false);
    expect(needsYou({ state: "RELEASED", role: "seller" })).toBe(false);
  });

  it("filters deals into groups accurately", () => {
    const all = filterDeals(SAMPLE_DEALS, "all");
    expect(all).toHaveLength(7);

    const active = filterDeals(SAMPLE_DEALS, "active");
    expect(active.map((d) => d.id)).toEqual(["1", "2", "3", "6", "7"]);

    const closed = filterDeals(SAMPLE_DEALS, "closed");
    expect(closed.map((d) => d.id)).toEqual(["4", "5"]);

    const needs = filterDeals(SAMPLE_DEALS, "needs-you");
    expect(needs.map((d) => d.id)).toEqual(["1", "2", "6", "7"]);
  });

  it("calculates filter counts accurately", () => {
    const counts = getFilterCounts(SAMPLE_DEALS);
    expect(counts).toEqual({
      all: 7,
      active: 5,
      "needs-you": 4,
      closed: 2,
    });
  });
});
