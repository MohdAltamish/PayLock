/**
 * The four seeded seller personas (BUILD_PLAN 2.1) and the demo buyer.
 * Display names describe behaviour, never label a person (invariant 11).
 * Timestamps are relative to "now" so `demo:reset` re-bases them (decision L).
 */
export interface Persona {
  key: "honest" | "fresh-account" | "off-platform" | "bad-deliverable";
  displayName: string;
  accountAgeDays: number;
  completedDeals: number;
  failedDeals: number;
  paypalVerified: boolean;
  /** Minutes since the payout email changed, or null if never. */
  payoutEmailChangedMinutesAgo: number | null;
  /** Opening message the demo adds to a new deal with this seller (untrusted text). */
  openingMessage: string | null;
  /** Demo deliverable slug served by the web app at /demo/deliverables/[slug]. */
  deliverable: "pass" | "bad" | null;
}

export const DEMO_BUYER = { key: "buyer", displayName: "Demo Buyer" } as const;

export const PERSONAS: Persona[] = [
  {
    key: "honest",
    displayName: "Honest Seller",
    accountAgeDays: 400,
    completedDeals: 24,
    failedDeals: 1,
    paypalVerified: true,
    payoutEmailChangedMinutesAgo: null,
    openingMessage: "Happy to help. I'll share a hosted link when it's ready.",
    deliverable: "pass",
  },
  {
    key: "fresh-account",
    displayName: "Fresh Account Seller",
    accountAgeDays: 2,
    completedDeals: 0,
    failedDeals: 0,
    paypalVerified: true,
    payoutEmailChangedMinutesAgo: 10,
    openingMessage:
      "I can start right now! To go faster, message me on WhatsApp and pay the deposit there instead of through Paylock.",
    deliverable: null,
  },
  {
    key: "off-platform",
    displayName: "Off-Platform Seller",
    accountAgeDays: 45,
    completedDeals: 0,
    failedDeals: 0,
    paypalVerified: false,
    payoutEmailChangedMinutesAgo: null,
    openingMessage:
      "Let's skip the platform fees. Send it as PayPal Friends and Family and I'll deliver tonight. This price is only good for the next hour.",
    deliverable: null,
  },
  {
    key: "bad-deliverable",
    displayName: "Rushed Delivery Seller",
    accountAgeDays: 300,
    completedDeals: 12,
    failedDeals: 1,
    paypalVerified: true,
    payoutEmailChangedMinutesAgo: null,
    openingMessage: "Sure, I'll get it done quickly.",
    deliverable: "bad",
  },
];
