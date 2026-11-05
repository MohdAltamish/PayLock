import { moneyState, toMoney } from "@paylock/schemas";
import type { PrismaClient } from "@prisma/client";

/**
 * API shape of a deal. No payout email, no raw PayPal bodies, no idempotency
 * keys. `confirming` is true while PayPal has not confirmed a capture or payout.
 */
export async function dealView(db: PrismaClient, dealId: string) {
  const d = await db.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: {
      buyer: { select: { id: true, displayName: true } },
      seller: { select: { id: true, displayName: true } },
      contract: true,
      risks: { orderBy: { createdAt: "desc" }, take: 1 },
      decisions: { orderBy: { createdAt: "desc" } },
      deliverables: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "asc" } },
      messages: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  const risk = d.risks[0];
  const pendingMoney = d.payments.filter(
    (p) => p.status === "PENDING" && ["CAPTURE", "PAYOUT", "REFUND", "AUTHORIZE"].includes(p.kind),
  );
  const meta = (d.contract?.modelMeta ?? {}) as { ambiguities?: string[] };
  return {
    id: d.id,
    state: d.state,
    moneyState: moneyState(d.state),
    confirming:
      pendingMoney.length > 0 && ["FUNDING", "RELEASING", "SETTLEMENT_ERROR"].includes(d.state),
    amount: toMoney(d.amount.toString()),
    currency: d.currency,
    blockReason: d.blockReason,
    requiresHumanRelease: d.requiresHumanRelease,
    paypalOrderId: d.paypalOrderId,
    authExpiresAt: d.authExpiresAt?.toISOString() ?? null,
    buyer: d.buyer,
    seller: d.seller,
    createdAt: d.createdAt.toISOString(),
    contract: d.contract && {
      title: d.contract.title,
      scope: d.contract.scope,
      criteria: d.contract.criteria,
      deadline: d.contract.deadline?.toISOString() ?? null,
      partialPayMin: d.contract.partialPayMin,
      ambiguities: meta.ambiguities ?? [],
    },
    risk: risk && {
      id: risk.id,
      score: risk.score,
      level: risk.level,
      signals: risk.signals,
      summary: risk.summary,
      action: risk.action,
      fallback: risk.fallback,
      overridden: risk.overridden,
    },
    decisions: d.decisions.map((x) => ({
      id: x.id,
      outcome: x.outcome,
      score: x.score,
      perCriterion: x.perCriterion,
      reasoning: x.reasoning,
      payoutPercent: x.payoutPercent,
      needsHumanReview: x.needsHumanReview,
      overridden: !!x.overriddenBy,
      overrideReason: x.overrideReason,
      createdAt: x.createdAt.toISOString(),
    })),
    deliverables: d.deliverables.map((x) => ({
      id: x.id,
      kind: x.kind,
      content: x.content,
      note: x.note,
      createdAt: x.createdAt.toISOString(),
    })),
    payments: d.payments.map((p) => ({
      kind: p.kind,
      attempt: p.attempt,
      status: p.status,
      paypalStatus: p.paypalStatus,
      paypalId: p.paypalId,
      amount: p.amount ? toMoney(p.amount.toString()) : null,
      error:
        (p.error as { name?: string; issue?: string } | null)?.issue ??
        (p.error as { name?: string } | null)?.name ??
        null,
      createdAt: p.createdAt.toISOString(),
    })),
    messages: d.messages.map((m) => ({
      id: m.id,
      from: m.authorId === d.buyerId ? "buyer" : "seller",
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
    events: d.events.map(eventView),
  };
}

export function eventView(e: {
  id: string;
  type: string;
  fromState: string | null;
  toState: string | null;
  actor: string;
  payload: unknown;
  createdAt: Date;
}) {
  return {
    id: e.id,
    type: e.type,
    fromState: e.fromState,
    toState: e.toState,
    actor: e.actor,
    payload: e.payload,
    createdAt: e.createdAt.toISOString(),
  };
}
