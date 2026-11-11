"use client";

import { MoneyBadge, StateBadge } from "@/components/ui";
import { money, type DealView } from "@/lib/api";
import { REASON_LABEL } from "@/lib/copy";

export function DealHeader({ deal }: { deal: DealView }) {
  return (
    <div className="sticky top-14 z-30 bg-background/95 backdrop-blur-xs border-b border-border/80 py-3.5 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-[26px] sm:text-[32px] font-extrabold leading-tight tracking-[-0.01em] text-text">
            {deal.contract?.title ?? "Deal"}
          </h1>
          <p className="text-xs sm:text-sm text-muted">
            <span className="font-medium text-text">{deal.buyer.displayName}</span>
            <span className="mx-1.5 text-muted">→</span>
            <span className="font-medium text-text">{deal.seller.displayName}</span>
            <span className="mx-2 text-border">·</span>
            <strong className="text-text tabular-nums">{money(deal.amount)}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <StateBadge state={deal.state} />
          <MoneyBadge deal={deal} />
        </div>
      </div>

      {deal.blockReason && (
        <p className="text-xs text-danger font-medium mt-2" data-testid="block-reason">
          {REASON_LABEL[deal.blockReason] ?? deal.blockReason}
        </p>
      )}
    </div>
  );
}
