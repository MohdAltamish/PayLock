import type {
  AcceptanceCriterion,
  ContractOut,
  DecisionOut,
  Money,
  RiskOut,
  Signal,
} from "@paylock/schemas";

/**
 * The agent boundary. Agents decide; the platform enforces (AI_AGENTS.md).
 * Inputs are already redacted where they reach an LLM; outputs are parsed
 * against packages/schemas before they are returned.
 */

export interface ModelMeta {
  mode: "stub" | "live" | "replay";
  model?: string;
  latencyMs?: number;
  attempts?: number;
  fixture?: string;
  [k: string]: unknown;
}

export interface NegotiateInput {
  request: string;
  sellerReply?: string;
}

export interface CounterpartyProfile {
  accountAgeDays: number;
  completedDeals: number;
  failedDeals: number;
  disputes: number;
  reportsReceived: number;
  payoutEmailChanges: number;
  /** Hours since the last payout email change, or null if never changed. */
  hoursSincePayoutEmailChange: number | null;
  paypalVerified: boolean;
  /** Domain of the contact email vs the payout email (for PAYOUT_EMAIL_MISMATCH). */
  contactDomain: string | null;
  payoutDomain: string | null;
}

export interface GuardInput {
  dealId: string;
  amount: Money;
  approvalThreshold: Money;
  contract: { title: string; scope: string; price: Money };
  seller: CounterpartyProfile;
  /** Seller's deals created in the last 10 minutes. */
  velocity10m: number;
  /** Seller's deals in the last 24h priced within 5% below the approval threshold. */
  nearThresholdDeals24h: number;
  /** After approval only: payment_source.paypal.account_status. */
  payerAccountStatus?: "VERIFIED" | "UNVERIFIED";
  /** Untrusted message bodies, oldest first. */
  messages: Array<{ author: "buyer" | "seller"; body: string }>;
  marketPrice?: { low: Money; high: Money };
}

export interface GuardResult {
  risk: RiskOut;
  /** true when the LLM failed and rules-only scoring was used (decision E). */
  fallback: boolean;
  modelMeta: ModelMeta;
}

export interface VerifyInput {
  dealId: string;
  contract: {
    title: string;
    scope: string;
    criteria: AcceptanceCriterion[];
    partialPayMin: number;
  };
  deliverable: { kind: string; content: string; note?: string | null };
}

export interface VerifyResult {
  /** null when the output failed schema validation twice (route to NEEDS_REVIEW). */
  decision: DecisionOut | null;
  modelMeta: ModelMeta;
}

export interface NegotiateResult {
  contract: ContractOut;
  modelMeta: ModelMeta;
}

export interface Agents {
  negotiate(input: NegotiateInput): Promise<NegotiateResult>;
  guard(input: GuardInput): Promise<GuardResult>;
  verify(input: VerifyInput): Promise<VerifyResult>;
}

export type { Signal };
