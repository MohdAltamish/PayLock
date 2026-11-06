export type WizardStep = 1 | 2 | 3 | null;

export const WIZARD_STEPS = [
  { step: 1, label: "Describe" },
  { step: 2, label: "Contract" },
  { step: 3, label: "Guard & Fund" },
] as const;

export function getDealStep(state?: string | null): WizardStep {
  if (!state || state === "DRAFT") return 1;
  if (state === "CONTRACTED") return 2;
  if (["GUARDED", "FLAGGED", "AWAITING_APPROVAL", "FUNDING"].includes(state)) return 3;
  return null;
}

