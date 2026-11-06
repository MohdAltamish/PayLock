export type ActorDisplay = "You" | "Buyer" | "Seller" | "Paylock AI" | "PayPal" | "Paylock";

export interface EventActorContext {
  currentUserId?: string;
  buyerId?: string;
  sellerId?: string;
  currentUserRole?: "buyer" | "seller";
}

export function getActorLabel(
  event: {
    actor: "HUMAN" | "AGENT" | "PAYPAL" | "SYSTEM" | string;
    type?: string;
    payload?: Record<string, unknown>;
  },
  context?: EventActorContext,
): ActorDisplay {
  const { actor, type = "", payload = {} } = event;

  if (actor === "AGENT") return "Paylock AI";
  if (actor === "PAYPAL") return "PayPal";
  if (actor === "SYSTEM") return "Paylock";

  if (actor === "HUMAN") {
    const userId = typeof payload.userId === "string" ? payload.userId : undefined;
    if (context?.currentUserId && userId && userId === context.currentUserId) {
      return "You";
    }

    const from = typeof payload.from === "string" ? payload.from : undefined;
    const isBuyerEvent =
      type.startsWith("buyer.") ||
      from === "buyer" ||
      (context?.buyerId && userId === context.buyerId);
    const isSellerEvent =
      type.startsWith("seller.") ||
      from === "seller" ||
      (context?.sellerId && userId === context.sellerId);

    if (isBuyerEvent) {
      if (
        context?.currentUserRole === "buyer" ||
        (context?.currentUserId && context?.buyerId && context.currentUserId === context.buyerId)
      ) {
        return "You";
      }
      return "Buyer";
    }

    if (isSellerEvent) {
      if (
        context?.currentUserRole === "seller" ||
        (context?.currentUserId && context?.sellerId && context.currentUserId === context.sellerId)
      ) {
        return "You";
      }
      return "Seller";
    }

    if (context?.currentUserRole) {
      return "You";
    }
    return "Buyer";
  }

  return "Paylock";
}
