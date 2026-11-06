"use client";

import { useEffect, useState } from "react";
import { ErrorNote, Shell, useMe } from "@/components/ui";
import { api } from "@/lib/api";

interface Policy {
  maxPerDeal: string;
  dailyCap: string;
  approvalThreshold: string;
  allowMediumRisk: boolean;
}

const MONEY = /^\d{1,10}\.\d{2}$/;

/** Spend policy. Enforced on the server; this page only edits it (ADR-003). */
export default function PolicyPage() {
  const me = useMe();
  const [p, setP] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (me) api<Policy>(`/users/${me.id}/policy`).then(setP, (e: Error) => setError(e.message));
  }, [me]);
  if (!me || !p)
    return (
      <Shell>
        <ErrorNote error={error} />
      </Shell>
    );
  const field = (k: keyof Omit<Policy, "allowMediumRisk">, label: string) => (
    <label>
      {label} (USD)
      <input
        value={p[k]}
        inputMode="decimal"
        pattern="\d{1,10}\.\d{2}"
        onChange={(e) => setP({ ...p, [k]: e.target.value })}
      />
    </label>
  );
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    setError(null);
    if (![p.maxPerDeal, p.dailyCap, p.approvalThreshold].every((v) => MONEY.test(v)))
      return setError("Amounts need two decimals, e.g. 500.00");
    try {
      setP(await api<Policy>(`/users/${me.id}/policy`, { method: "PUT", body: p }));
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Shell>
      <h1>Spend policy</h1>
      <form className="card" onSubmit={save}>
        {field("maxPerDeal", "Max per deal")}
        {field("dailyCap", "Daily cap")}
        {field("approvalThreshold", "Approval threshold")}
        <label className="row">
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={p.allowMediumRisk}
            onChange={(e) => setP({ ...p, allowMediumRisk: e.target.checked })}
          />
          Fund medium-risk deals without asking me (signals are still logged)
        </label>
        <p className="muted">
          Deals up to ${p.approvalThreshold} fund without your tap when risk is Low
          {p.allowMediumRisk ? " or Medium" : ""}; anything above that or riskier needs your
          approval. Nothing over ${p.maxPerDeal} per deal or ${p.dailyCap} per day is ever funded.
        </p>
        <ErrorNote error={error} />
        {saved && <p role="status">Saved.</p>}
        <button type="submit">Save policy</button>
      </form>
    </Shell>
  );
}
