"use client";

import { useEffect, useRef } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  FileText,
  Lock,
  RotateCcw,
  Shield,
  type LucideIcon,
} from "lucide-react";
import type { DealView } from "@/lib/api";
import { eventTitle } from "@/lib/copy";
import { getActorLabel, type ActorDisplay, type EventActorContext } from "@/lib/actors";
import { Card, CardHeader, CardTitle } from "@/components/primitives/Card";
import { cn } from "@/lib/cn";

const HIDE = new Set(["paypal.order.created"]);

function getEventIcon(type: string, isAlert: boolean): LucideIcon {
  if (isAlert || type.includes("failed") || type.includes("error")) return AlertCircle;
  if (type.includes("contract")) return FileText;
  if (type.includes("risk")) return Shield;
  if (type.includes("authorization") || type === "paypal.authorization.created") return Lock;
  if (type.includes("released") || type.includes("completed") || type.includes("approve"))
    return CheckCircle2;
  if (type.includes("void") || type.includes("refund") || type.includes("reject")) return RotateCcw;
  if (type.includes("started") || type.includes("review") || type.includes("order")) return Clock;
  return Circle;
}

const actorChipStyles: Record<ActorDisplay, string> = {
  You: "bg-blue-50 text-blue-700 border-blue-200",
  Buyer: "bg-slate-100 text-slate-700 border-slate-200",
  Seller: "bg-slate-100 text-slate-700 border-slate-200",
  "Paylock AI": "bg-purple-50 text-purple-700 border-purple-200",
  PayPal: "bg-indigo-50 text-indigo-700 border-indigo-200",
  Paylock: "bg-slate-100 text-slate-700 border-slate-200",
};

/** Timeline of DealEvents, newest at the bottom, announced politely to screen readers. */
export function Timeline({
  events,
  context,
}: {
  events: DealView["events"];
  context?: EventActorContext;
}) {
  const containerRef = useRef<HTMLOListElement>(null);

  const visibleEvents = events.filter((e) => !HIDE.has(e.type));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom < 150) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleEvents.length]);

  return (
    <Card className="p-4 sm:p-5">
      <CardHeader className="mb-3">
        <CardTitle>Timeline</CardTitle>
      </CardHeader>
      <ol
        ref={containerRef}
        className="space-y-3.5 max-h-[500px] overflow-y-auto pr-1"
        aria-live="polite"
        aria-relevant="additions"
        data-testid="timeline"
      >
        {visibleEvents.map((e, index) => {
          const p = e.payload ?? {};
          const isAlert = p.alert === true;
          const Icon = getEventIcon(e.type, isAlert);
          const actorLabel = getActorLabel(e, context);

          const ids = [
            "orderId",
            "authorizationId",
            "captureId",
            "batchId",
            "refundId",
            "resourceId",
          ]
            .filter((k) => typeof p[k] === "string" && p[k])
            .map((k) => `${k}: ${String(p[k])}`);

          const fullDate = new Date(e.createdAt).toLocaleString();
          const timeStr = new Date(e.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });

          return (
            <li
              key={e.id}
              style={{ animationDelay: `${index * 40}ms` }}
              className={cn(
                "group relative flex items-start gap-3 p-2.5 rounded-control transition-all duration-150 animate-in fade-in slide-in-from-bottom-1",
                isAlert ? "bg-red-50/70 border border-red-200/80" : "hover:bg-slate-50/80",
              )}
            >
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border mt-0.5",
                  isAlert
                    ? "bg-red-100 border-red-300 text-danger"
                    : "bg-surface border-border text-muted group-hover:text-text group-hover:border-slate-300",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </div>

              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold border",
                        actorChipStyles[actorLabel],
                      )}
                    >
                      {actorLabel}
                    </span>
                    <span
                      className={cn(
                        "text-sm font-medium leading-snug",
                        isAlert ? "text-danger font-semibold" : "text-text",
                      )}
                    >
                      {eventTitle(e.type, p)}
                    </span>
                  </div>

                  <time
                    dateTime={e.createdAt}
                    title={fullDate}
                    className="text-xs text-muted shrink-0 cursor-help underline decoration-dotted underline-offset-2"
                  >
                    {timeStr}
                  </time>
                </div>

                {(ids.length > 0 || typeof p.paypalIssue === "string") && (
                  <details className="mt-1 text-xs text-muted group/details">
                    <summary className="cursor-pointer hover:text-text font-medium select-none">
                      Details
                    </summary>
                    <div className="mt-1.5 p-2 rounded bg-slate-100 font-mono text-[11px] break-all space-y-0.5 border border-border/80">
                      {ids.map((idStr) => (
                        <div key={idStr}>{idStr}</div>
                      ))}
                      {typeof p.paypalIssue === "string" && (
                        <div className="text-danger font-sans">PayPal: {p.paypalIssue}</div>
                      )}
                    </div>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
