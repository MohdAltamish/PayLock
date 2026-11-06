"use client";

import type { DealView } from "@/lib/api";

/** Verifier decision: outcome, score, per-criterion results with confidence and evidence. */
export function DecisionPanel({
  decision,
  deal,
}: {
  decision: DealView["decisions"][number];
  deal: DealView;
}) {
  const criteria = new Map((deal.contract?.criteria ?? []).map((c) => [c.id, c]));
  return (
    <section className="card" data-testid="decision-panel">
      <h2>
        Verification:{" "}
        <span className={`badge outcome-${decision.outcome}`}>{decision.outcome}</span>{" "}
        <span className="muted">{decision.score}% of weighted criteria met</span>
      </h2>
      <table className="criteria">
        <thead>
          <tr>
            <th scope="col">Criterion</th>
            <th scope="col">Met</th>
            <th scope="col">Confidence</th>
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {decision.perCriterion.map((r) => (
            <tr key={r.criterionId}>
              <td>{criteria.get(r.criterionId)?.description ?? r.criterionId}</td>
              <td>{r.met ? "✓ Yes" : "✗ No"}</td>
              <td>
                <meter
                  min={0}
                  max={1}
                  value={r.confidence}
                  aria-label={`confidence ${Math.round(r.confidence * 100)}%`}
                />{" "}
                {Math.round(r.confidence * 100)}%
              </td>
              <td>{r.evidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>{decision.reasoning}</p>
      {decision.needsHumanReview && (
        <p className="muted">This decision needs a person to confirm it.</p>
      )}
      {decision.overrideReason && <p className="muted">Your note: {decision.overrideReason}</p>}
    </section>
  );
}
