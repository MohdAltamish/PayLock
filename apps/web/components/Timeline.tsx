"use client";

import type { DealView } from "@/lib/api";
import { ACTOR_LABEL, eventTitle } from "@/lib/copy";

const HIDE = new Set(["paypal.order.created"]);

/** Timeline of DealEvents, newest at the bottom, announced politely to screen readers. */
export function Timeline({ events }: { events: DealView["events"] }) {
  return (
    <section className="card">
      <h2>Timeline</h2>
      <ol className="timeline" aria-live="polite" aria-relevant="additions" data-testid="timeline">
        {events
          .filter((e) => !HIDE.has(e.type))
          .map((e) => {
            const p = e.payload ?? {};
            const alert = p.alert === true;
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
            return (
              <li key={e.id} className={alert ? "alert" : undefined}>
                <span className={`actor actor-${e.actor}`}>{ACTOR_LABEL[e.actor]}</span>
                <span className="title">{eventTitle(e.type, p)}</span>
                <time dateTime={e.createdAt}>{new Date(e.createdAt).toLocaleTimeString()}</time>
                {ids.length > 0 && <div className="ids">{ids.join(" · ")}</div>}
                {typeof p.paypalIssue === "string" && (
                  <div className="ids">PayPal: {p.paypalIssue}</div>
                )}
              </li>
            );
          })}
      </ol>
    </section>
  );
}
