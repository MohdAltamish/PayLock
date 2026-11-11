"use client";

import { useState } from "react";
import { AlertCircle, Check, CheckCircle2, X, XCircle } from "lucide-react";
import type { DealView } from "@/lib/api";
import { Badge } from "@/components/primitives/Badge";
import { Card, CardHeader, CardTitle } from "@/components/primitives/Card";
import { cn } from "@/lib/cn";
import { type Tone } from "@/lib/tone";

const OUTCOME_CONFIG: Record<string, { tone: Tone; icon: typeof CheckCircle2; label: string }> = {
  PASS: { tone: "success", icon: CheckCircle2, label: "PASS" },
  PARTIAL: { tone: "warning", icon: AlertCircle, label: "PARTIAL" },
  FAIL: { tone: "danger", icon: XCircle, label: "FAIL" },
};

function ScoreRing({ score }: { score: number }) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg className="w-16 h-16 transform -rotate-90" aria-hidden="true">
        <circle
          cx="32"
          cy="32"
          r={radius}
          stroke="currentColor"
          strokeWidth="4"
          className="text-slate-200"
          fill="transparent"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          stroke="currentColor"
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn(
            score >= 80 ? "text-success" : score >= 50 ? "text-warning" : "text-danger",
          )}
          fill="transparent"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-bold text-text tabular-nums">{score}%</span>
      </div>
    </div>
  );
}

function EvidenceCell({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 120;

  if (!isLong) return <span>{text}</span>;

  return (
    <div>
      <p className="leading-snug">{expanded ? text : `${text.slice(0, 110)}…`}</p>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-accent hover:underline font-medium mt-1 cursor-pointer"
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}

/** Verifier decision: outcome, score, per-criterion results with confidence and evidence. */
export function DecisionPanel({
  decision,
  deal,
}: {
  decision: DealView["decisions"][number];
  deal: DealView;
}) {
  const criteria = new Map((deal.contract?.criteria ?? []).map((c) => [c.id, c]));
  const outcomeInfo = OUTCOME_CONFIG[decision.outcome] ?? {
    tone: "neutral" as Tone,
    icon: AlertCircle,
    label: decision.outcome,
  };
  const OutcomeIcon = outcomeInfo.icon;

  return (
    <Card className="p-4 sm:p-5 space-y-4" data-testid="decision-panel">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3 mb-0">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CardTitle>Verification</CardTitle>
            <Badge
              tone={outcomeInfo.tone}
              icon={<OutcomeIcon className="w-3.5 h-3.5" aria-hidden="true" />}
              className={`outcome-${decision.outcome}`}
            >
              {outcomeInfo.label}
            </Badge>
          </div>
          <p className="text-xs text-muted">{decision.score}% of weighted criteria met</p>
        </div>

        <ScoreRing score={decision.score} />
      </CardHeader>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-border text-xs font-bold text-muted uppercase tracking-wider">
              <th scope="col" className="pb-2 pr-4">
                Criterion
              </th>
              <th scope="col" className="pb-2 px-3">
                Met
              </th>
              <th scope="col" className="pb-2 px-3">
                Confidence
              </th>
              <th scope="col" className="pb-2 pl-3">
                Evidence
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {decision.perCriterion.map((r) => (
              <tr key={r.criterionId} className="align-top">
                <td className="py-2.5 pr-4 text-xs font-medium text-text">
                  {criteria.get(r.criterionId)?.description ?? r.criterionId}
                </td>
                <td className="py-2.5 px-3 whitespace-nowrap">
                  {r.met ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-success">
                      <Check className="w-3.5 h-3.5" aria-hidden="true" /> Yes
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-danger">
                      <X className="w-3.5 h-3.5" aria-hidden="true" /> No
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-3 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <meter
                      min={0}
                      max={1}
                      value={r.confidence}
                      aria-label={`confidence ${Math.round(r.confidence * 100)}%`}
                      className="w-14 h-2 rounded bg-slate-100"
                    />
                    <span className="text-xs text-muted tabular-nums font-mono">
                      {Math.round(r.confidence * 100)}%
                    </span>
                  </div>
                </td>
                <td className="py-2.5 pl-3 text-xs text-muted">
                  <EvidenceCell text={r.evidence} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {decision.perCriterion.map((r) => (
          <div
            key={r.criterionId}
            className="p-3 rounded-control border border-border/70 bg-slate-50/50 space-y-2 text-xs"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-text">
                {criteria.get(r.criterionId)?.description ?? r.criterionId}
              </p>
              {r.met ? (
                <span className="inline-flex items-center gap-1 font-bold text-success shrink-0">
                  <Check className="w-3.5 h-3.5" aria-hidden="true" /> Yes
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-bold text-danger shrink-0">
                  <X className="w-3.5 h-3.5" aria-hidden="true" /> No
                </span>
              )}
            </div>
            <div className="flex items-center justify-between text-muted">
              <span>Confidence:</span>
              <span className="font-mono tabular-nums font-medium">
                {Math.round(r.confidence * 100)}%
              </span>
            </div>
            <div className="text-muted pt-1 border-t border-border/50">
              <EvidenceCell text={r.evidence} />
            </div>
          </div>
        ))}
      </div>

      <div className="pt-2 border-t border-border/60 space-y-2">
        <p className="text-xs sm:text-sm text-text leading-relaxed">{decision.reasoning}</p>
        {decision.needsHumanReview && (
          <p className="text-xs text-warning-text font-medium">
            This decision needs a person to confirm it.
          </p>
        )}
        {decision.overrideReason && (
          <p className="text-xs text-muted">Your note: {decision.overrideReason}</p>
        )}
      </div>
    </Card>
  );
}
