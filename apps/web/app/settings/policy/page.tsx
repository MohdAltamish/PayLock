"use client";

import { useEffect, useState } from "react";
import { ErrorNote, Shell, useMe } from "@/components/ui";
import { Button } from "@/components/primitives/Button";
import { Card } from "@/components/primitives/Card";
import { Field, Input } from "@/components/primitives/Field";
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (me) api<Policy>(`/users/${me.id}/policy`).then(setP, (e: Error) => setError(e.message));
  }, [me]);

  if (!me || !p) {
    return (
      <Shell>
        <ErrorNote error={error} />
      </Shell>
    );
  }

  const field = (k: keyof Omit<Policy, "allowMediumRisk">, label: string) => (
    <Field id={`policy-${k}`} label={`${label} (USD)`}>
      <Input
        id={`policy-${k}`}
        value={p[k]}
        inputMode="decimal"
        pattern="\d{1,10}\.\d{2}"
        onChange={(e) => setP({ ...p, [k]: e.target.value })}
      />
    </Field>
  );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    setError(null);
    if (![p.maxPerDeal, p.dailyCap, p.approvalThreshold].every((v) => MONEY.test(v))) {
      return setError("Amounts need two decimals, e.g. 500.00");
    }
    setSaving(true);
    try {
      setP(await api<Policy>(`/users/${me.id}/policy`, { method: "PUT", body: p }));
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell>
      <div className="max-w-xl mx-auto space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Spend policy</h1>
        <Card>
          <form className="space-y-4" onSubmit={save}>
            {field("maxPerDeal", "Max per deal")}
            {field("dailyCap", "Daily cap")}
            {field("approvalThreshold", "Approval threshold")}

            <label className="flex items-start gap-2.5 pt-1 text-sm text-text cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 rounded border-border text-accent focus:ring-accent"
                checked={p.allowMediumRisk}
                onChange={(e) => setP({ ...p, allowMediumRisk: e.target.checked })}
              />
              <span>Fund medium-risk deals without asking me (signals are still logged)</span>
            </label>

            <p className="text-xs text-muted leading-relaxed bg-slate-50 p-3 rounded-control border border-border">
              Deals up to ${p.approvalThreshold} fund without your tap when risk is Low
              {p.allowMediumRisk ? " or Medium" : ""}; anything above that or riskier needs your
              approval. Nothing over ${p.maxPerDeal} per deal or ${p.dailyCap} per day is ever
              funded.
            </p>

            <ErrorNote error={error} />
            {saved && (
              <p role="status" className="text-xs font-semibold text-success">
                Saved.
              </p>
            )}

            <Button type="submit" loading={saving}>
              Save policy
            </Button>
          </form>
        </Card>
      </div>
    </Shell>
  );
}
