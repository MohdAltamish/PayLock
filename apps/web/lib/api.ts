"use client";

/** Calls the Paylock API through the same-origin /api proxy (decision J). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: {
      title?: string;
      detail?: string;
      type?: string;
      paypal_issue?: string;
    },
  ) {
    super(
      problem.detail
        ? `${problem.title ?? "Error"}: ${problem.detail}`
        : (problem.title ?? `HTTP ${status}`),
    );
    this.name = "ApiError";
  }
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) throw new ApiError(res.status, (data ?? {}) as ApiError["problem"]);
  return data as T;
}

export const post = <T = unknown>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body });

export interface Me {
  id: string;
  displayName: string;
  role: "buyer" | "seller";
}

export interface DealEventView {
  id: string;
  type: string;
  fromState: string | null;
  toState: string | null;
  actor: "HUMAN" | "AGENT" | "PAYPAL" | "SYSTEM";
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Signal {
  code: string;
  weight: number;
  evidence: string;
  source: "rule" | "llm";
}

export interface DealView {
  id: string;
  state: string;
  moneyState:
    "none" | "reserving" | "reserved" | "releasing" | "released" | "returned" | "attention";
  confirming: boolean;
  amount: string;
  currency: string;
  blockReason: string | null;
  requiresHumanRelease: boolean;
  paypalOrderId: string | null;
  authExpiresAt: string | null;
  buyer: { id: string; displayName: string };
  seller: { id: string; displayName: string };
  contract: {
    title: string;
    scope: string;
    criteria: Array<{ id: string; description: string; weight: number; verifiable: string }>;
    deadline: string | null;
    partialPayMin: number;
    ambiguities: string[];
  } | null;
  risk?: {
    score: number;
    level: "LOW" | "MEDIUM" | "HIGH";
    signals: Signal[];
    summary: string;
    action: string;
    fallback: boolean;
    overridden: boolean;
  };
  decisions: Array<{
    id: string;
    outcome: "PASS" | "PARTIAL" | "FAIL";
    score: number;
    perCriterion: Array<{
      criterionId: string;
      met: boolean;
      confidence: number;
      evidence: string;
    }>;
    reasoning: string;
    payoutPercent: number;
    needsHumanReview: boolean;
    overridden: boolean;
    overrideReason: string | null;
  }>;
  deliverables: Array<{ id: string; kind: string; content: string; note: string | null }>;
  payments: Array<{
    kind: string;
    attempt: number;
    status: string;
    paypalStatus: string | null;
    paypalId: string | null;
    amount: string | null;
    error: string | null;
  }>;
  messages: Array<{ id: string; from: "buyer" | "seller"; body: string; createdAt: string }>;
  events: DealEventView[];
}

export function money(v: string) {
  return `$${v} USD`;
}
