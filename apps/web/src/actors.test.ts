import { describe, expect, it } from "vitest";
import { getActorLabel } from "../lib/actors";

describe("actor labeling", () => {
  it("labels AGENT as Paylock AI", () => {
    expect(getActorLabel({ actor: "AGENT" })).toBe("Paylock AI");
  });

  it("labels PAYPAL as PayPal", () => {
    expect(getActorLabel({ actor: "PAYPAL" })).toBe("PayPal");
  });

  it("labels SYSTEM as Paylock", () => {
    expect(getActorLabel({ actor: "SYSTEM" })).toBe("Paylock");
  });

  it("labels HUMAN buyer event as You when current user is buyer", () => {
    const label = getActorLabel(
      { actor: "HUMAN", type: "buyer.approve" },
      { currentUserRole: "buyer" },
    );
    expect(label).toBe("You");
  });

  it("labels HUMAN buyer event as Buyer when current user is seller", () => {
    const label = getActorLabel(
      { actor: "HUMAN", type: "buyer.approve" },
      { currentUserRole: "seller" },
    );
    expect(label).toBe("Buyer");
  });

  it("labels HUMAN seller event as You when current user is seller", () => {
    const label = getActorLabel(
      { actor: "HUMAN", type: "seller.deliverable.submitted" },
      { currentUserRole: "seller" },
    );
    expect(label).toBe("You");
  });

  it("labels HUMAN seller event as Seller when current user is buyer", () => {
    const label = getActorLabel(
      { actor: "HUMAN", type: "seller.deliverable.submitted" },
      { currentUserRole: "buyer" },
    );
    expect(label).toBe("Seller");
  });
});
