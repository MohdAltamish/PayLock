"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { moneyState, type DealState } from "@paylock/schemas";
import { ErrorNote, Shell } from "@/components/ui";
import { Badge } from "@/components/primitives/Badge";
import { ButtonLink } from "@/components/primitives/Button";
import { Card } from "@/components/primitives/Card";
import { Skeleton } from "@/components/primitives/Skeleton";
import { api } from "@/lib/api";
import { MONEY_LABEL, STATE_LABEL } from "@/lib/copy";
import {
  filterDeals,
  getFilterCounts,
  type FilterableDeal,
  type FilterKey,
} from "@/lib/dealFilters";
import { getMoneyTone, getStateTone } from "@/lib/tone";
import { cn } from "@/lib/cn";

interface DealRow extends FilterableDeal {
  amount: string;
  title: string | null;
  buyer: string;
  seller: string;
  createdAt: string;
}

const FILTER_LABELS: Record<FilterKey, string> = {
  all: "All",
  active: "Active",
  "needs-you": "Needs you",
  closed: "Closed",
};

export default function DealsPage() {
  const [deals, setDeals] = useState<DealRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("filter") as FilterKey | null;
      if (q && ["all", "active", "needs-you", "closed"].includes(q)) {
        setActiveFilter(q);
      }
    }

    api<{ deals: DealRow[] }>("/deals").then(
      (r) => setDeals(r.deals),
      (e: Error) => setError(e.message),
    );
  }, []);

  const setFilter = (f: FilterKey) => {
    setActiveFilter(f);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (f === "all") {
        url.searchParams.delete("filter");
      } else {
        url.searchParams.set("filter", f);
      }
      window.history.replaceState(null, "", url.toString());
    }
  };

  const counts = deals ? getFilterCounts(deals) : { all: 0, active: 0, "needs-you": 0, closed: 0 };
  const filtered = deals ? filterDeals(deals, activeFilter) : [];

  return (
    <Shell>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-[32px] font-extrabold leading-tight tracking-[-0.01em] text-text">
              Deals
            </h1>
            <p className="text-xs sm:text-sm text-muted">
              Manage your active and completed escrow transactions.
            </p>
          </div>
          <ButtonLink href="/deals/new" size="sm">
            Create deal
          </ButtonLink>
        </div>

        <ErrorNote error={error} />

        {/* Filter Segmented Control (Radio Group) */}
        <div
          role="radiogroup"
          aria-label="Filter deals"
          className="inline-flex p-1 rounded-control bg-slate-100 border border-border text-xs font-medium"
        >
          {(["all", "active", "needs-you", "closed"] as FilterKey[]).map((f) => {
            const isSelected = activeFilter === f;
            return (
              <button
                type="button"
                key={f}
                role="radio"
                aria-checked={isSelected}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-3 py-1.5 rounded-control transition-colors duration-150 flex items-center gap-1.5 cursor-pointer",
                  isSelected
                    ? "bg-surface text-text font-bold shadow-xs"
                    : "text-slate-600 hover:text-text",
                )}
              >
                <span>{FILTER_LABELS[f]}</span>
                <span
                  className={cn(
                    "px-1.5 py-0.2 rounded-full text-[10px] tabular-nums",
                    isSelected
                      ? "bg-slate-100 text-text font-bold"
                      : "bg-slate-200 text-slate-700 font-medium",
                  )}
                >
                  {counts[f]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Loading state */}
        {!deals && !error && (
          <Card className="p-0 overflow-hidden">
            <div className="divide-y divide-border p-4 space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between pt-2">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-5 w-16" />
                    <Skeleton className="h-6 w-24 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Empty states */}
        {deals && filtered.length === 0 && (
          <Card className="py-12 text-center space-y-3">
            <p className="text-sm text-muted">
              {activeFilter === "all"
                ? "No deals yet."
                : activeFilter === "active"
                  ? "No active deals."
                  : activeFilter === "needs-you"
                    ? "No deals need your attention right now."
                    : "No closed deals."}
            </p>
            {activeFilter === "all" && (
              <div>
                <ButtonLink href="/deals/new">Create your first deal</ButtonLink>
              </div>
            )}
          </Card>
        )}

        {/* Deals Table (desktop) & Cards (mobile) */}
        {deals && filtered.length > 0 && (
          <Card className="p-0 overflow-hidden">
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border bg-slate-50/50 text-xs font-bold text-muted uppercase tracking-wider">
                    <th scope="col" className="py-3 px-4">
                      Title & Counterparty
                    </th>
                    <th scope="col" className="py-3 px-4">
                      Amount
                    </th>
                    <th scope="col" className="py-3 px-4">
                      Escrow State
                    </th>
                    <th scope="col" className="py-3 px-4">
                      Deal Status
                    </th>
                    <th scope="col" className="py-3 px-4 text-right">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {filtered.map((d) => {
                    const mState = moneyState(d.state as DealState);
                    const { tone: mTone, icon: MIcon } = getMoneyTone(mState);
                    const { tone: sTone, icon: SIcon } = getStateTone(d.state);

                    return (
                      <tr key={d.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4">
                          <Link
                            href={`/deals/${d.id}`}
                            className="font-bold text-text hover:text-accent hover:underline text-sm block"
                          >
                            {d.title ?? "Untitled Deal"}
                          </Link>
                          <span className="text-xs text-muted">
                            {d.role === "buyer" ? `with ${d.seller}` : `for ${d.buyer}`}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 tabular-nums font-bold text-text">
                          ${d.amount}
                        </td>
                        <td className="py-3.5 px-4">
                          <Badge
                            tone={mTone}
                            icon={<MIcon className="w-3.5 h-3.5" aria-hidden="true" />}
                          >
                            {MONEY_LABEL[mState] ?? mState}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-4">
                          <Badge
                            tone={sTone}
                            icon={<SIcon className="w-3.5 h-3.5" aria-hidden="true" />}
                          >
                            {STATE_LABEL[d.state] ?? d.state}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-4 text-right text-xs text-muted whitespace-nowrap">
                          {new Date(d.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List View */}
            <div className="md:hidden divide-y divide-border">
              {filtered.map((d) => {
                const mState = moneyState(d.state as DealState);
                const { tone: mTone, icon: MIcon } = getMoneyTone(mState);
                const { tone: sTone, icon: SIcon } = getStateTone(d.state);

                return (
                  <div key={d.id} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          href={`/deals/${d.id}`}
                          className="font-bold text-text text-sm hover:text-accent block leading-tight"
                        >
                          {d.title ?? "Untitled Deal"}
                        </Link>
                        <p className="text-xs text-muted mt-0.5">
                          {d.role === "buyer" ? `with ${d.seller}` : `for ${d.buyer}`}
                        </p>
                      </div>
                      <span className="font-bold text-text tabular-nums text-sm shrink-0">
                        ${d.amount}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/50">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          tone={mTone}
                          icon={<MIcon className="w-3.5 h-3.5" aria-hidden="true" />}
                        >
                          {MONEY_LABEL[mState] ?? mState}
                        </Badge>
                        <Badge
                          tone={sTone}
                          icon={<SIcon className="w-3.5 h-3.5" aria-hidden="true" />}
                        >
                          {STATE_LABEL[d.state] ?? d.state}
                        </Badge>
                      </div>
                      <span className="text-[11px] text-muted">
                        {new Date(d.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </Shell>
  );
}
