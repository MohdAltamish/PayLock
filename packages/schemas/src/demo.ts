/**
 * Demo presets shared by the web wizard and the agent eval (which records
 * their replay fixtures). Changing any text here needs `npm run eval:record`.
 */
export interface DemoPreset {
  key: "happy" | "scam" | "offPlatform" | "fail";
  label: string;
  /** Seller persona display name (apps/api/src/demo/personas.ts). */
  seller: string;
  personaKey: "honest" | "fresh-account" | "off-platform" | "bad-deliverable";
  request: string;
  /** Slug served by the web app at /demo/deliverables/[slug]. */
  deliverable: "pass" | "bad" | null;
}

export const DEMO_PRESETS: DemoPreset[] = [
  {
    key: "happy",
    label: "Bakery landing page ($120)",
    seller: "Honest Seller",
    personaKey: "honest",
    request:
      "Need a landing page for my bakery, mobile friendly, with a menu section and a contact form. Budget $120.",
    deliverable: "pass",
  },
  {
    key: "scam",
    label: "Coffee cart logo ($90)",
    seller: "Fresh Account Seller",
    personaKey: "fresh-account",
    request: "Need a simple logo for my coffee cart. Budget $90.",
    deliverable: null,
  },
  {
    key: "offPlatform",
    label: "Coffee cart logo ($90)",
    seller: "Off-Platform Seller",
    personaKey: "off-platform",
    request: "Need a simple logo for my coffee cart. Budget $90.",
    deliverable: null,
  },
  {
    key: "fail",
    label: "Bakery landing page ($80)",
    seller: "Rushed Delivery Seller",
    personaKey: "bad-deliverable",
    request:
      "Need a landing page for my bakery, mobile friendly, with a menu section and a contact form. Budget $80.",
    deliverable: "bad",
  },
];
