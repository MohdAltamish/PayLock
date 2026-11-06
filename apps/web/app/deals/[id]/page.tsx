"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DecisionPanel } from "@/components/DecisionPanel";
import { RiskBanner } from "@/components/RiskBanner";
import { Timeline } from "@/components/Timeline";
import { ErrorNote, Shell, useMe } from "@/components/ui";
import { Card } from "@/components/primitives/Card";
import { Skeleton } from "@/components/primitives/Skeleton";
import { Spinner } from "@/components/primitives/Spinner";
import { BuyerActions } from "@/components/deal/BuyerActions";
import { ContractSidebar } from "@/components/deal/ContractSidebar";
import { DealHeader } from "@/components/deal/DealHeader";
import { DeliverForm } from "@/components/deal/DeliverForm";
import { ReviewCard } from "@/components/deal/ReviewCard";
import { SettlementError } from "@/components/deal/SettlementError";
import { api, type DealView } from "@/lib/api";

export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const [deal, setDeal] = useState<DealView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [testCard, setTestCard] = useState(false);

  const load = useCallback(async () => {
    try {
      setDeal(await api<DealView>(`/deals/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  // Live updates: SSE through the /api proxy, 2s polling as the fallback.
  const sseOk = useRef(false);
  useEffect(() => {
    void load();
    api<{ testCardFunding?: boolean }>("/config/paypal").then(
      (c) => setTestCard(!!c.testCardFunding),
      () => {},
    );
    const es = new EventSource(`/api/deals/${id}/events`);
    es.addEventListener("deal", () => {
      sseOk.current = true;
      void load();
    });
    es.onerror = () => {
      sseOk.current = false;
    };
    const poll = setInterval(() => {
      if (!sseOk.current) void load();
    }, 2000);
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [id, load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      await load();
    }
  };

  const onDone = useCallback(() => void load(), [load]);
  const onMessage = useCallback((m: string) => setNote(m), []);

  if (!deal) {
    return (
      <Shell>
        <ErrorNote error={error} />
        {!error && (
          <div className="space-y-6 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-4 w-72" />
              </div>
              <Skeleton className="h-8 w-36 rounded-full" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              <div className="md:col-span-8 space-y-4">
                <Skeleton className="h-44 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
              <div className="md:col-span-4 space-y-4">
                <Skeleton className="h-80 w-full" />
              </div>
            </div>
          </div>
        )}
      </Shell>
    );
  }

  const isBuyer = me?.id === deal.buyer.id;
  const isSeller = me?.id === deal.seller.id;
  const decision = deal.decisions[0];

  return (
    <Shell>
      <DealHeader deal={deal} />

      <ErrorNote error={error} />
      {note && (
        <div
          role="status"
          className="mb-4 p-3 rounded-control border border-amber-200 bg-amber-50 text-amber-900 text-xs"
        >
          {note}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Left column (actions, decision, errors, timeline) */}
        <div className="md:col-span-7 lg:col-span-8 space-y-5">
          {deal.risk && <RiskBanner risk={deal.risk} />}

          {isBuyer && (
            <BuyerActions
              deal={deal}
              busy={busy}
              act={act}
              testCard={testCard}
              onDone={onDone}
              onMessage={onMessage}
            />
          )}

          {isSeller && deal.state === "LOCKED" && <DeliverForm deal={deal} busy={busy} act={act} />}

          {isSeller &&
            ["CONTRACTED", "GUARDED", "AWAITING_APPROVAL", "FLAGGED", "FUNDING"].includes(
              deal.state,
            ) && (
              <Card className="p-4 sm:p-5">
                <p className="text-xs text-muted">
                  Waiting for the buyer to reserve funds with PayPal. You will be cleared to submit
                  deliverables once escrow is funded.
                </p>
              </Card>
            )}

          {["DELIVERED", "VERIFYING"].includes(deal.state) && !decision && (
            <Card className="p-4 sm:p-5 flex items-center gap-3 text-sm" aria-busy="true">
              <Spinner size="md" className="text-accent" />
              <span>Paylock AI is reviewing the work against acceptance criteria…</span>
            </Card>
          )}

          {decision && <DecisionPanel decision={decision} deal={deal} />}

          {isBuyer && deal.state === "NEEDS_REVIEW" && decision && (
            <ReviewCard deal={deal} decisionId={decision.id} busy={busy} act={act} />
          )}

          {deal.state === "SETTLEMENT_ERROR" && (
            <SettlementError deal={deal} busy={busy} act={act} isBuyer={isBuyer} />
          )}

          <Timeline
            events={deal.events}
            context={{
              currentUserId: me?.id,
              buyerId: deal.buyer.id,
              sellerId: deal.seller.id,
              currentUserRole: me?.role,
            }}
          />
        </div>

        {/* Right column (Contract, messages, payments) */}
        <div className="md:col-span-5 lg:col-span-4">
          <ContractSidebar deal={deal} />
        </div>
      </div>
    </Shell>
  );
}
