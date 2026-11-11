"use client";

import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Card, CardHeader, CardTitle } from "@/components/primitives/Card";
import { post, type DealView } from "@/lib/api";

type Act = (label: string, fn: () => Promise<unknown>) => Promise<void>;

export function SettlementError({
  deal,
  busy,
  act,
  isBuyer,
}: {
  deal: DealView;
  busy: string | null;
  act: Act;
  isBuyer: boolean;
}) {
  const failed = deal.payments.filter((p) => p.status === "FAILED").at(-1);

  return (
    <Card
      className="p-4 sm:p-5 border-red-200 bg-red-50/30 space-y-3"
      role="alert"
      data-testid="settlement-error"
    >
      <CardHeader className="flex flex-row items-center gap-2 pb-2 mb-0">
        <AlertTriangle className="w-5 h-5 text-danger shrink-0" aria-hidden="true" />
        <CardTitle className="text-danger">PayPal could not complete this step</CardTitle>
      </CardHeader>
      <p className="text-xs text-text">
        Step: <span className="font-bold">{failed?.kind.toLowerCase() ?? "settlement"}</span>
        {failed?.error ? ` · PayPal: ${failed.error}` : ""}
        {failed?.paypalStatus ? ` · status ${failed.paypalStatus}` : ""}
      </p>

      {isBuyer && (
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button
            variant="secondary"
            disabled={!!busy}
            loading={busy === "retry"}
            onClick={() => act("retry", () => post(`/deals/${deal.id}/settlement/retry`))}
            icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
          >
            {busy === "retry" ? "Retrying…" : "Retry"}
          </Button>

          {deal.payments.some((p) => p.kind === "CAPTURE" && p.status === "SUCCEEDED") && (
            <Button
              variant="destructive"
              disabled={!!busy}
              loading={busy === "refund"}
              onClick={() => act("refund", () => post(`/deals/${deal.id}/settlement/refund`))}
              icon={<RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}
            >
              Refund the buyer
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
