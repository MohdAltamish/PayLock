"use client";

import type { DealView } from "@/lib/api";

const LEVEL = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" } as const;

/** UI_UX "Risk banner". Signals, evidence and source (Rule / AI) are always shown. */
export function RiskBanner({ risk }: { risk: NonNullable<DealView["risk"]> }) {
  const shown = risk.signals.filter((s) => s.weight !== 0);
  return (
    <section
      className={`card risk risk-${risk.level}`}
      role={risk.level === "HIGH" ? "alert" : "status"}
      aria-live="polite"
      data-testid="risk-banner"
    >
      <h2>
        <span aria-hidden="true">{risk.level === "LOW" ? "🛡️" : "⚠️"}</span> Risk:{" "}
        {LEVEL[risk.level]}
        <span className="muted"> · score {risk.score}/100</span>
      </h2>
      <p>{risk.summary}</p>
      {risk.fallback && (
        <p className="muted">The AI message check was unavailable; only rule signals were used.</p>
      )}
      <details open={risk.level !== "LOW"}>
        <summary>See risk signals ({shown.length})</summary>
        <ul className="signals">
          {shown.map((s, i) => (
            <li key={`${s.code}-${i}`}>
              <span className={`tag tag-${s.source}`}>{s.source === "rule" ? "Rule" : "AI"}</span>{" "}
              <strong>{s.code.replaceAll("_", " ").toLowerCase()}</strong> (
              {s.weight > 0 ? "+" : ""}
              {s.weight}): {s.evidence}
            </li>
          ))}
        </ul>
      </details>
      {risk.overridden && (
        <p className="muted">You overrode this check. Release will need your approval.</p>
      )}
    </section>
  );
}
