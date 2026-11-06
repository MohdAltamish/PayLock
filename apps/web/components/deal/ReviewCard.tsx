"use client";

import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Card, CardHeader, CardTitle } from "@/components/primitives/Card";
import { Field, Input } from "@/components/primitives/Field";
import { post, type DealView } from "@/lib/api";

type Act = (label: string, fn: () => Promise<unknown>) => Promise<void>;

export function ReviewCard({
  deal,
  decisionId,
  busy,
  act,
}: {
  deal: DealView;
  decisionId: string;
  busy: string | null;
  act: Act;
}) {
  const [reason, setReason] = useState("");

  const send = (action: "approve" | "reject") =>
    act(action, () =>
      post(`/deals/${deal.id}/decisions/${decisionId}/override`, { action, reason }),
    );

  const canSubmit = !busy && reason.trim().length >= 3;

  return (
    <Card
      className="p-4 sm:p-5 space-y-4 border-amber-200 bg-amber-50/20"
      data-testid="review-card"
    >
      <CardHeader className="mb-1">
        <CardTitle>Review the decision</CardTitle>
      </CardHeader>
      <p className="text-xs text-muted">
        This verification requires your human judgment. Please provide a brief note explaining your
        decision before releasing or rejecting.
      </p>

      <Field id="review-note" label="Your note (required, logged in audit trail)">
        <Input
          id="review-note"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={3}
          placeholder="e.g. Verified deliverables meet revised requirements"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button
          disabled={!canSubmit}
          loading={busy === "approve"}
          onClick={() => send("approve")}
          icon={<CheckCircle2 className="w-4 h-4" aria-hidden="true" />}
        >
          Approve release
        </Button>
        <Button
          variant="destructive"
          disabled={!canSubmit}
          loading={busy === "reject"}
          onClick={() => send("reject")}
          icon={<XCircle className="w-4 h-4" aria-hidden="true" />}
        >
          Reject and return funds
        </Button>
      </div>
    </Card>
  );
}
