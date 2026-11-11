"use client";

import { Check, Clock, FileText, MessageSquare, Wallet, X } from "lucide-react";
import type { DealView } from "@/lib/api";
import { Card, CardHeader, CardTitle } from "@/components/primitives/Card";

export function ContractSidebar({ deal }: { deal: DealView }) {
  const decision = deal.decisions[0];

  return (
    <aside className="space-y-4 md:sticky md:top-32">
      {/* Contract Card */}
      {deal.contract && (
        <Card className="p-4 sm:p-5 space-y-3">
          <CardHeader className="flex flex-row items-center gap-2 pb-2 mb-0">
            <FileText className="w-4 h-4 text-accent" aria-hidden="true" />
            <CardTitle className="text-sm">Contract</CardTitle>
          </CardHeader>

          <p className="text-xs text-text leading-relaxed bg-slate-50 p-2.5 rounded-control border border-border">
            {deal.contract.scope}
          </p>

          <div className="space-y-2 pt-1">
            <p className="text-xs font-bold text-muted uppercase tracking-wider">Criteria</p>
            <div className="space-y-2">
              {deal.contract.criteria.map((c) => {
                const r = decision?.perCriterion.find((x) => x.criterionId === c.id);
                return (
                  <div
                    key={c.id}
                    className="p-2.5 rounded-control border border-border bg-surface text-xs space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-1.5 flex-1 min-w-0">
                        {r ? (
                          r.met ? (
                            <Check
                              className="w-3.5 h-3.5 text-success shrink-0 mt-0.5"
                              aria-hidden="true"
                            />
                          ) : (
                            <X
                              className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5"
                              aria-hidden="true"
                            />
                          )
                        ) : null}
                        <span className="text-text font-medium leading-snug">{c.description}</span>
                      </div>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                        Checked by {c.verifiable === "llm" ? "AI" : c.verifiable}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-muted pt-1 border-t border-border/50">
                      <span>Weight</span>
                      <div className="flex items-center gap-1.5">
                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent rounded-full"
                            style={{ width: `${Math.min(100, c.weight * 20)}%` }}
                          />
                        </div>
                        <span className="font-mono font-medium">{c.weight}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {deal.contract.ambiguities.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-border/60">
              <p className="text-xs font-bold text-warning-text">Ambiguities identified</p>
              {deal.contract.ambiguities.map((a, i) => (
                <p
                  key={i}
                  className="text-xs text-amber-900 bg-amber-50 p-2 rounded-control border border-amber-200"
                >
                  {a}
                </p>
              ))}
            </div>
          )}

          <div className="text-[11px] text-muted space-y-1 pt-2 border-t border-border/60">
            <p>Partial payment minimum: {deal.contract.partialPayMin}%</p>
            <p className="flex items-center gap-1">
              <Clock className="w-3 h-3" aria-hidden="true" />
              <span>
                Deadline:{" "}
                {deal.contract.deadline
                  ? new Date(deal.contract.deadline).toLocaleString()
                  : "Not set"}
              </span>
            </p>
          </div>
        </Card>
      )}

      {/* Messages Card */}
      {deal.messages.length > 0 && (
        <Card className="p-4 sm:p-5 space-y-3">
          <CardHeader className="flex flex-row items-center gap-2 pb-2 mb-0">
            <MessageSquare className="w-4 h-4 text-accent" aria-hidden="true" />
            <CardTitle className="text-sm">Messages</CardTitle>
          </CardHeader>
          <div className="space-y-2">
            {deal.messages.map((m) => (
              <div
                key={m.id}
                className="p-2.5 rounded-control bg-slate-50 border border-border text-xs space-y-1"
              >
                <div className="flex items-center justify-between font-bold text-text">
                  <span>
                    {m.from === "buyer" ? deal.buyer.displayName : deal.seller.displayName}
                  </span>
                  <span className="text-[10px] text-muted font-normal">
                    {new Date(m.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="text-muted leading-relaxed">{m.body}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Payments Card */}
      {deal.payments.length > 0 && (
        <Card className="p-4 sm:p-5 space-y-3">
          <CardHeader className="flex flex-row items-center gap-2 pb-2 mb-0">
            <Wallet className="w-4 h-4 text-accent" aria-hidden="true" />
            <CardTitle className="text-sm">Payments</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-border/60 text-xs">
            {deal.payments.map((p) => (
              <li key={`${p.kind}-${p.attempt}`} className="py-2 first:pt-0 last:pb-0 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-text capitalize">
                    {p.kind.toLowerCase()} #{p.attempt}
                  </span>
                  <span className="font-bold text-text tabular-nums">
                    {p.amount ? `$${p.amount} ` : ""}
                    <span className="font-normal text-muted">
                      ({p.paypalStatus ?? p.status.toLowerCase()})
                    </span>
                  </span>
                </div>
                <div className="font-mono text-[11px] text-muted break-all">
                  {p.paypalId ?? "-"}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </aside>
  );
}
