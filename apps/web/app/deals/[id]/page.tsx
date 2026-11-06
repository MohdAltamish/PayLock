"use client";

import { DEMO_PRESETS } from "@paylock/schemas";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DecisionPanel } from "@/components/DecisionPanel";
import { PayPalButton } from "@/components/PayPalButton";
import { RiskBanner } from "@/components/RiskBanner";
import { Timeline } from "@/components/Timeline";
import { ErrorNote, MoneyBadge, Shell, StateBadge, useMe } from "@/components/ui";
import { api, money, post, type DealView } from "@/lib/api";
import { REASON_LABEL } from "@/lib/copy";

/** Deal detail (UI_UX "Deal detail"): one primary action per state, live timeline. */
export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const [deal, setDeal] = useState<DealView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [testCard, setTestCard] = useState(false);

  const load = useCallback(async () => {
    try {
      setDeal(await api<DealView>(`/deals/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  // Live updates: SSE through the /api proxy (decision J), 2s polling as the fallback.
  const sseOk = useRef(false);
  useEffect(() => {
    void load();
    api<{ testCardFunding?: boolean }>("/config/paypal").then(
      (c) => setTestCard(!!c.testCardFunding),
      () => {},
    );
    const es = new EventSource(`/api/deals/${id}/events`);
    es.addEventListener("deal", () => {
      sseOk.current = true;
      void load();
    });
    es.onerror = () => {
      sseOk.current = false;
    };
    const poll = setInterval(() => {
      if (!sseOk.current) void load();
    }, 2000);
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [id, load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      await load();
    }
  };
  const onDone = useCallback(() => void load(), [load]);
  const onMessage = useCallback((m: string) => setNote(m), []);

  if (!deal)
    return (
      <Shell>
        <ErrorNote error={error} />
        {!error && <p className="muted">Loading…</p>}
      </Shell>
    );

  const isBuyer = me?.id === deal.buyer.id;
  const isSeller = me?.id === deal.seller.id;
  const decision = deal.decisions[0];
  const failed = deal.payments.filter((p) => p.status === "FAILED").at(-1);

  return (
    <Shell>
      <header className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>{deal.contract?.title ?? "Deal"}</h1>
          <p className="muted">
            {deal.buyer.displayName} → {deal.seller.displayName} ·{" "}
            <strong>{money(deal.amount)}</strong>
          </p>
        </div>
        <div className="row">
          <StateBadge state={deal.state} />
          <MoneyBadge deal={deal} />
        </div>
      </header>
      {deal.blockReason && (
        <p className="muted" data-testid="block-reason">
          {REASON_LABEL[deal.blockReason] ?? deal.blockReason}
        </p>
      )}
      <ErrorNote error={error} />
      {note && (
        <p role="status" className="callout">
          {note}
        </p>
      )}

      <div className="grid">
        <div>
          {deal.risk && <RiskBanner risk={deal.risk} />}

          {isBuyer && (
            <BuyerActions
              deal={deal}
              busy={busy}
              act={act}
              testCard={testCard}
              onDone={onDone}
              onMessage={onMessage}
            />
          )}

          {isSeller && deal.state === "LOCKED" && <DeliverForm deal={deal} busy={busy} act={act} />}
          {isSeller &&
            ["CONTRACTED", "GUARDED", "AWAITING_APPROVAL", "FLAGGED", "FUNDING"].includes(
              deal.state,
            ) && (
              <section className="card">
                <p className="muted">
                  Waiting for the buyer to reserve funds. You can deliver once funds are reserved.
                </p>
              </section>
            )}

          {["DELIVERED", "VERIFYING"].includes(deal.state) && !decision && (
            <section className="card" aria-busy="true">
              <p>Paylock AI is reviewing the work…</p>
            </section>
          )}

          {decision && <DecisionPanel decision={decision} deal={deal} />}

          {isBuyer && deal.state === "NEEDS_REVIEW" && decision && (
            <ReviewCard deal={deal} decisionId={decision.id} busy={busy} act={act} />
          )}

          {deal.state === "SETTLEMENT_ERROR" && (
            <section className="card alertcard" role="alert" data-testid="settlement-error">
              <h2>PayPal could not complete this step</h2>
              <p>
                Step: {failed?.kind.toLowerCase() ?? "settlement"}
                {failed?.error ? ` · PayPal: ${failed.error}` : ""}
                {failed?.paypalStatus ? ` · status ${failed.paypalStatus}` : ""}
              </p>
              {isBuyer && (
                <div className="row">
                  <button
                    disabled={!!busy}
                    onClick={() => act("retry", () => post(`/deals/${id}/settlement/retry`))}
                  >
                    {busy === "retry" ? "Retrying…" : "Retry"}
                  </button>
                  {deal.payments.some((p) => p.kind === "CAPTURE" && p.status === "SUCCEEDED") && (
                    <button
                      className="secondary"
                      disabled={!!busy}
                      onClick={() => act("refund", () => post(`/deals/${id}/settlement/refund`))}
                    >
                      Refund the buyer
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          <Timeline events={deal.events} />
        </div>

        <aside>
          {deal.contract && (
            <section className="card">
              <h2>Contract</h2>
              <p>{deal.contract.scope}</p>
              <ol>
                {deal.contract.criteria.map((c) => {
                  const r = decision?.perCriterion.find((x) => x.criterionId === c.id);
                  return (
                    <li key={c.id}>
                      {r ? (r.met ? "✓ " : "✗ ") : ""}
                      {c.description}{" "}
                      <span className="muted">
                        (weight {c.weight}, {c.verifiable === "llm" ? "AI" : c.verifiable})
                      </span>
                    </li>
                  );
                })}
              </ol>
              {deal.contract.ambiguities.map((a) => (
                <p key={a} className="callout">
                  {a}
                </p>
              ))}
              <p className="muted">
                Partial payment from {deal.contract.partialPayMin}% · Deadline{" "}
                {deal.contract.deadline
                  ? new Date(deal.contract.deadline).toLocaleString()
                  : "not set"}
              </p>
            </section>
          )}
          {deal.messages.length > 0 && (
            <section className="card">
              <h2>Messages</h2>
              {deal.messages.map((m) => (
                <p key={m.id}>
                  <strong>
                    {m.from === "buyer" ? deal.buyer.displayName : deal.seller.displayName}:
                  </strong>{" "}
                  {m.body}
                </p>
              ))}
            </section>
          )}
          {deal.payments.length > 0 && (
            <section className="card">
              <h2>Payments</h2>
              <ul className="list">
                {deal.payments.map((p) => (
                  <li key={`${p.kind}-${p.attempt}`}>
                    <span>
                      {p.kind.toLowerCase()} #{p.attempt}
                      <br />
                      <span className="muted">{p.paypalId ?? "-"}</span>
                    </span>
                    <span>
                      {p.amount ? `$${p.amount} ` : ""}
                      {p.paypalStatus ?? p.status.toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </Shell>
  );
}

type Act = (label: string, fn: () => Promise<unknown>) => Promise<void>;

function BuyerActions({
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
  const [showOverride, setShowOverride] = useState(false);
  const id = deal.id;
  const cancel = (
    <button
      className="secondary"
      disabled={!!busy}
      onClick={() => act("cancel", () => post(`/deals/${id}/cancel`))}
    >
      Cancel deal
    </button>
  );
  switch (deal.state) {
    case "CONTRACTED":
      return (
        <section className="card">
          <p>Review the contract, then let Paylock AI check the seller for risk signals.</p>
          <div className="row">
            <button
              disabled={!!busy}
              onClick={() => act("guard", () => post(`/deals/${id}/guard`))}
              data-testid="run-guard"
            >
              {busy === "guard" ? "Checking risk signals…" : "Run risk check"}
            </button>
            {cancel}
          </div>
        </section>
      );
    case "FLAGGED":
      return (
        <section className="card">
          <div className="row">
            <button
              className="danger"
              disabled={!!busy}
              onClick={() => act("cancel", () => post(`/deals/${id}/cancel`))}
              data-testid="do-not-fund"
            >
              Do not fund
            </button>
            {deal.blockReason !== "POLICY_CAP" && (
              <button className="link" onClick={() => setShowOverride(true)}>
                Override anyway
              </button>
            )}
          </div>
          {deal.blockReason === "POLICY_CAP" && (
            <p className="muted">Spend limits cannot be overridden.</p>
          )}
          {showOverride && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act("override", () => post(`/deals/${id}/override`, { reason }));
              }}
            >
              <label>
                Why do you want to fund this anyway? (logged; release will need your approval)
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={3}
                  required
                />
              </label>
              <button type="submit" disabled={!!busy}>
                Override and continue
              </button>
            </form>
          )}
        </section>
      );
    case "AWAITING_APPROVAL":
      return (
        <section className="card">
          <p>This deal needs your approval before funds are reserved.</p>
          <div className="row">
            <button
              disabled={!!busy}
              onClick={() => act("approve", () => post(`/deals/${id}/approve`))}
            >
              Review and approve
            </button>
            {cancel}
          </div>
        </section>
      );
    case "GUARDED":
    case "FUNDING":
      return (
        <section className="card">
          <h2>Reserve {money(deal.amount)}</h2>
          <p className="muted">
            PayPal holds the money. Nothing is sent to the seller until the work is verified.
          </p>
          <PayPalButton dealId={id} amount={deal.amount} onDone={onDone} onMessage={onMessage} />
          {testCard && deal.state === "GUARDED" && (
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() => act("card", () => post("/test/fund-with-card", { dealId: id }))}
              data-testid="fund-test-card"
            >
              {busy === "card" ? "Reserving…" : "Reserve with sandbox test card (E2E)"}
            </button>
          )}
          <div className="row" style={{ marginTop: "0.75rem" }}>
            {cancel}
          </div>
        </section>
      );
    default:
      return null;
  }
}

function DeliverForm({ deal, busy, act }: { deal: DealView; busy: string | null; act: Act }) {
  const [kind, setKind] = useState<"url" | "text">("url");
  const [content, setContent] = useState("");
  const preset = DEMO_PRESETS.find((p) => p.seller === deal.seller.displayName && p.deliverable);
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void act("deliver", () => post(`/deals/${deal.id}/deliverables`, { kind, content }));
      }}
    >
      <h2>Submit your work</h2>
      <p className="muted">
        Funds are reserved. Paylock AI checks the delivery against the contract.
      </p>
      {preset && (
        <div className="chips">
          <button
            type="button"
            onClick={() => {
              setKind("url");
              setContent(`${window.location.origin}/demo/deliverables/${preset.deliverable}`);
            }}
            data-testid="use-demo-deliverable"
          >
            Use the demo deliverable
          </button>
        </div>
      )}
      <label>
        Type
        <select value={kind} onChange={(e) => setKind(e.target.value as "url" | "text")}>
          <option value="url">Hosted URL</option>
          <option value="text">Text</option>
        </select>
      </label>
      <label>
        {kind === "url" ? "URL" : "Text"}
        {kind === "url" ? (
          <input
            type="url"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            data-testid="deliverable"
          />
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            data-testid="deliverable"
          />
        )}
      </label>
      <button type="submit" disabled={!!busy || !content} data-testid="submit-deliverable">
        {busy === "deliver" ? "Submitting…" : "Submit for verification"}
      </button>
    </form>
  );
}

function ReviewCard({
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
  return (
    <section className="card" data-testid="review-card">
      <h2>Review the decision</h2>
      <label>
        Your note (required, logged)
        <input value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} />
      </label>
      <div className="row">
        <button disabled={!!busy || reason.trim().length < 3} onClick={() => send("approve")}>
          Approve release
        </button>
        <button
          className="danger"
          disabled={!!busy || reason.trim().length < 3}
          onClick={() => send("reject")}
        >
          Reject and return funds
        </button>
      </div>
    </section>
  );
}
