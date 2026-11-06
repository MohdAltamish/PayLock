"use client";

import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import type { DealView } from "@/lib/api";
import { Card } from "@/components/primitives/Card";
import { cn } from "@/lib/cn";

const LEVEL_MAP = {
  LOW: {
    label: "Risk: Low",
    rec: "Recommended: safe to fund",
    border: "border-l-4 border-l-success border-border",
    badgeBg: "bg-emerald-50 text-emerald-800 border-emerald-200",
    icon: ShieldCheck,
  },
  MEDIUM: {
    label: "Risk: Medium",
    rec: "Recommended: review before funding",
    border: "border-l-4 border-l-warning border-border",
    badgeBg: "bg-amber-50 text-amber-800 border-amber-200",
    icon: ShieldAlert,
  },
  HIGH: {
    label: "Risk: High",
    rec: "Recommended: do not fund",
    border: "border-l-4 border-l-danger border-border bg-red-50/30",
    badgeBg: "bg-red-50 text-red-800 border-red-200",
    icon: ShieldX,
  },
} as const;

/** UI_UX "Risk banner". Signals, evidence and source (Rule / AI) are always shown. */
export function RiskBanner({ risk }: { risk: NonNullable<DealView["risk"]> }) {
  const shown = risk.signals.filter((s) => s.weight !== 0);
  const config = LEVEL_MAP[risk.level] ?? LEVEL_MAP.LOW;
  const Icon = config.icon;

  return (
    <Card
      className={cn("p-4 sm:p-5 space-y-3", config.border)}
      role={risk.level === "HIGH" ? "alert" : "status"}
      aria-live="polite"
      data-testid="risk-banner"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
          <h2 className="text-base font-semibold text-text">{config.label}</h2>
          <span className="text-xs text-muted font-medium">· score {risk.score}/100</span>
        </div>
        <span className="text-xs font-semibold px-2 py-0.5 rounded border bg-slate-50 text-muted">
          {config.rec}
        </span>
      </div>

      <p className="text-sm text-text leading-relaxed">{risk.summary}</p>

      {risk.fallback && (
        <p className="text-xs text-muted">
          The AI message check was unavailable; only rule signals were used.
        </p>
      )}

      {shown.length > 0 && (
        <details open={risk.level !== "LOW"} className="text-xs group">
          <summary className="font-medium text-text cursor-pointer hover:text-accent select-none">
            See risk signals ({shown.length})
          </summary>
          <ul className="mt-2 space-y-1.5 pl-2 border-l border-border/80">
            {shown.map((s, i) => (
              <li key={`${s.code}-${i}`} className="text-muted leading-snug">
                <span
                  className={cn(
                    "inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold uppercase tracking-wider mr-1.5 border",
                    s.source === "rule"
                      ? "bg-slate-100 text-slate-700 border-slate-200"
                      : "bg-blue-50 text-blue-700 border-blue-200",
                  )}
                >
                  {s.source === "rule" ? "Rule" : "AI"}
                </span>
                <strong className="text-text font-semibold">
                  {s.code.replaceAll("_", " ").toLowerCase()}
                </strong>{" "}
                ({s.weight > 0 ? "+" : ""}
                {s.weight}): {s.evidence}
              </li>
            ))}
          </ul>
        </details>
      )}

      {risk.overridden && (
        <p className="text-xs text-muted border-t border-border/60 pt-2">
          You overrode this check. Release will need your approval.
        </p>
      )}
    </Card>
  );
}
