export type FilterKey = "all" | "active" | "needs-you" | "closed";

export interface FilterableDeal {
  id: string;
  state: string;
  role: "buyer" | "seller";
  [key: string]: unknown;
}

export const CLOSED_STATES = new Set(["RELEASED", "RELEASED_PARTIAL", "VOIDED", "CANCELLED"]);

export function isClosed(state: string): boolean {
  return CLOSED_STATES.has(state);
}

export function isActive(state: string): boolean {
  return !isClosed(state);
}

export function needsYou(deal: { state: string; role: "buyer" | "seller" }): boolean {
  if (deal.role === "buyer") {
    return [
      "CONTRACTED",
      "FLAGGED",
      "AWAITING_APPROVAL",
      "NEEDS_REVIEW",
      "SETTLEMENT_ERROR",
    ].includes(deal.state);
  }
  if (deal.role === "seller") {
    return deal.state === "LOCKED";
  }
  return false;
}

export function filterDeals<T extends FilterableDeal>(deals: T[], filter: FilterKey): T[] {
  switch (filter) {
    case "active":
      return deals.filter((d) => isActive(d.state));
    case "needs-you":
      return deals.filter((d) => needsYou(d));
    case "closed":
      return deals.filter((d) => isClosed(d.state));
    case "all":
    default:
      return deals;
  }
}

export function getFilterCounts<T extends FilterableDeal>(deals: T[]): Record<FilterKey, number> {
  return {
    all: deals.length,
    active: deals.filter((d) => isActive(d.state)).length,
    "needs-you": deals.filter((d) => needsYou(d)).length,
    closed: deals.filter((d) => isClosed(d.state)).length,
  };
}
