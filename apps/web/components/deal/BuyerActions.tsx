"use client";

import { useState } from "react";
import { AlertTriangle, ShieldCheck, XCircle } from "lucide-react";
import { PayPalButton } from "@/components/PayPalButton";
import { Button } from "@/components/primitives/Button";
import { Card, CardHeader, CardTitle } from "@/components/primitives/Card";
import { Dialog } from "@/components/primitives/Dialog";
import { Field, Input } from "@/components/primitives/Field";
import { money, post, type DealView } from "@/lib/api";

type Act = (label: string, fn: () => Promise<unknown>) => Promise<void>;

export function BuyerActions({
  deal,
  busy,
  act,
  testCard,
  onDone,
  onMessage,
}: {
  deal: DealView;
  busy: string | null;
  act: Act;
  testCard: boolean;
  onDone: () => void;
  onMessage: (m: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const id = deal.id;

  const handleCancel = async () => {
    setShowCancelDialog(false);
    await act("cancel", () => post(`/deals/${id}/cancel`));
  };

  const handleOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowOverrideDialog(false);
    await act("override", () => post(`/deals/${id}/override`, { reason }));
  };

  const cancelTrigger = (
    <Button
      variant="ghost"
      size="sm"
      disabled={!!busy}
      onClick={() => setShowCancelDialog(true)}
      className="text-muted hover:text-danger hover:bg-red-50"
    >
      Cancel deal
    </Button>
  );

  return (
    <>
      {/* Dialog for cancel confirmation */}
      <Dialog
        open={showCancelDialog}
        onClose={() => setShowCancelDialog(false)}
        title="Cancel deal?"
        description="Are you sure you want to cancel this deal? This action cannot be undone."
      >
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border mt-4">
          <Button variant="secondary" onClick={() => setShowCancelDialog(false)}>
            Keep deal
          </Button>
          <Button variant="destructive" loading={busy === "cancel"} onClick={handleCancel}>
            Yes, cancel deal
          </Button>
        </div>
      </Dialog>

      {/* Dialog for risk override */}
      <Dialog
        open={showOverrideDialog}
        onClose={() => setShowOverrideDialog(false)}
        title="Override risk signals"
        description="Why do you want to fund this anyway? Your note is logged in the audit trail, and funds will not be released without your approval."
      >
        <form onSubmit={handleOverride} className="space-y-4 pt-2">
          <Field id="override-reason" label="Reason for overriding">
            <Input
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={3}
              required
              placeholder="e.g. Existing trusted counterparty from previous project"
            />
          </Field>
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <Button variant="secondary" type="button" onClick={() => setShowOverrideDialog(false)}>
              Back
            </Button>
            <Button
              type="submit"
              disabled={reason.trim().length < 3 || !!busy}
              loading={busy === "override"}
            >
              Override and continue
            </Button>
          </div>
        </form>
      </Dialog>

      {/* CONTRACTED state: Review the contract */}
      {deal.state === "CONTRACTED" && (
        <Card className="p-4 sm:p-5 space-y-4">
          <CardHeader className="mb-2">
            <CardTitle>Review the contract</CardTitle>
          </CardHeader>

          {deal.contract && (
            <div className="space-y-3 text-xs">
              <p className="text-text font-medium leading-relaxed bg-slate-50 p-3 rounded-control border border-border">
                {deal.contract.scope}
              </p>

              <div className="space-y-2">
                <p className="font-semibold text-muted uppercase tracking-wider text-[11px]">
                  Acceptance Criteria ({deal.contract.criteria.length})
                </p>
                <div className="space-y-2">
                  {deal.contract.criteria.map((c) => (
                    <div
                      key={c.id}
                      className="p-2.5 rounded-control border border-border bg-surface flex items-start justify-between gap-3"
                    >
                      <div className="space-y-1 flex-1">
                        <p className="text-text font-medium leading-snug">{c.description}</p>
                        <div className="flex items-center gap-2 text-muted text-[11px]">
                          <span>Weight: {c.weight}</span>
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent rounded-full"
                              style={{ width: `${Math.min(100, c.weight * 20)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                        Checked by {c.verifiable === "llm" ? "AI" : c.verifiable}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {deal.contract.ambiguities.length > 0 && (
                <div className="space-y-1 pt-1">
                  <p className="font-semibold text-warning-text text-[11px]">Ambiguities flagged</p>
                  {deal.contract.ambiguities.map((a, i) => (
                    <p
                      key={i}
                      className="text-amber-900 bg-amber-50 p-2 rounded-control border border-amber-200"
                    >
                      {a}
                    </p>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between text-[11px] text-muted pt-2 border-t border-border/60">
                <span>Partial payment minimum: {deal.contract.partialPayMin}%</span>
                <span>
                  Deadline:{" "}
                  {deal.contract.deadline
                    ? new Date(deal.contract.deadline).toLocaleDateString()
                    : "Not set"}
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/60">
            <Button
              onClick={() => act("guard", () => post(`/deals/${id}/guard`))}
              loading={busy === "guard"}
              data-testid="run-guard"
              icon={<ShieldCheck className="w-4 h-4" aria-hidden="true" />}
            >
              {busy === "guard" ? "Checking risk signals…" : "Run risk check"}
            </Button>
            {cancelTrigger}
          </div>
        </Card>
      )}

      {/* FLAGGED state */}
      {deal.state === "FLAGGED" && (
        <Card className="p-4 sm:p-5 space-y-4 border-red-200 bg-red-50/20">
          <CardHeader className="mb-2">
            <CardTitle className="text-danger flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" aria-hidden="true" />
              High risk signals detected
            </CardTitle>
          </CardHeader>
          <p className="text-sm text-text">
            Paylock identified elevated risk signals on this deal. We recommend cancelling this deal
            and not funding.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <Button
              variant="destructive"
              disabled={!!busy}
              loading={busy === "cancel"}
              onClick={() => act("cancel", () => post(`/deals/${id}/cancel`))}
              data-testid="do-not-fund"
              icon={<XCircle className="w-4 h-4" aria-hidden="true" />}
            >
              Do not fund
            </Button>

            {deal.blockReason !== "POLICY_CAP" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowOverrideDialog(true)}
                className="text-muted hover:text-text"
              >
                Override anyway
              </Button>
            ) : (
              <span className="text-xs text-muted">Spend limits cannot be overridden.</span>
            )}
          </div>
        </Card>
      )}

      {/* AWAITING_APPROVAL state */}
      {deal.state === "AWAITING_APPROVAL" && (
        <Card className="p-4 sm:p-5 space-y-4 border-amber-200 bg-amber-50/20">
          <CardHeader className="mb-2">
            <CardTitle>Approval required</CardTitle>
          </CardHeader>
          <p className="text-sm text-text">
            This deal requires your explicit approval under your spend policy before funds can be
            reserved.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <Button
              onClick={() => act("approve", () => post(`/deals/${id}/approve`))}
              loading={busy === "approve"}
            >
              Review and approve
            </Button>
            {cancelTrigger}
          </div>
        </Card>
      )}

      {/* GUARDED or FUNDING state: Guard & fund step */}
      {(deal.state === "GUARDED" || deal.state === "FUNDING") && (
        <Card className="p-4 sm:p-5 space-y-5">
          <CardHeader className="mb-1">
            <CardTitle>Reserve {money(deal.amount)}</CardTitle>
          </CardHeader>

          {/* Deal summary bar */}
          <div className="grid grid-cols-3 gap-2 p-3 rounded-control bg-slate-50 border border-border text-xs">
            <div>
              <span className="text-muted block">Amount</span>
              <span className="font-semibold text-text tabular-nums text-sm">
                {money(deal.amount)}
              </span>
            </div>
            <div>
              <span className="text-muted block">Seller</span>
              <span className="font-semibold text-text truncate block">
                {deal.seller.displayName}
              </span>
            </div>
            <div>
              <span className="text-muted block">Criteria</span>
              <span className="font-semibold text-text">
                {deal.contract?.criteria.length ?? 0} items
              </span>
            </div>
          </div>

          <p className="text-xs text-muted leading-relaxed">
            PayPal reserves and holds the funds. Nothing is sent to the seller until the deliverable
            is submitted and proven against the contract.
          </p>

          {/* PayPal button container */}
          <div className="p-4 rounded-control border border-border/80 bg-slate-50/60 paypal-box">
            <PayPalButton dealId={id} amount={deal.amount} onDone={onDone} onMessage={onMessage} />
          </div>

          {testCard && deal.state === "GUARDED" && (
            <div className="pt-2">
              <Button
                variant="secondary"
                disabled={!!busy}
                loading={busy === "card"}
                onClick={() => act("card", () => post("/test/fund-with-card", { dealId: id }))}
                data-testid="fund-test-card"
                className="w-full text-xs"
              >
                {busy === "card" ? "Reserving…" : "Reserve with sandbox test card (E2E)"}
              </Button>
            </div>
          )}

          <div className="flex items-center justify-end pt-2 border-t border-border/60">
            {cancelTrigger}
          </div>
        </Card>
      )}
    </>
  );
}
