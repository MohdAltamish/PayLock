"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { ErrorNote, Shell, useMe } from "@/components/ui";
import { Button } from "@/components/primitives/Button";
import { Card, CardHeader, CardTitle } from "@/components/primitives/Card";
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
    <Field id={`policy-${k}`} label={label}>
      <div className="relative flex items-center">
        <span
          className="absolute left-3 text-sm font-bold text-muted pointer-events-none select-none"
          aria-hidden="true"
        >
          $
        </span>
        <Input
          id={`policy-${k}`}
          value={p[k]}
          inputMode="decimal"
          pattern="\d{1,10}\.\d{2}"
          className="pl-7 tabular-nums"
          onChange={(e) => setP({ ...p, [k]: e.target.value })}
        />
      </div>
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
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h1 className="text-[32px] font-extrabold leading-tight tracking-[-0.01em] text-text">
            Spend policy
          </h1>
          <p className="text-xs sm:text-sm text-muted">
            Configure automated funding limits and risk approval requirements.
          </p>
        </div>

        <Card className="p-4 sm:p-6">
          <CardHeader className="mb-4">
            <CardTitle>Spending Limits (USD)</CardTitle>
          </CardHeader>

          <form className="space-y-5" onSubmit={save}>
            {field("maxPerDeal", "Max per deal")}
            {field("dailyCap", "Daily cap")}
            {field("approvalThreshold", "Approval threshold")}

            <label className="flex items-start gap-3 p-3.5 rounded-control border border-border bg-slate-50/70 text-xs sm:text-sm text-text cursor-pointer hover:bg-slate-50 transition-colors">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent accent-accent cursor-pointer"
                checked={p.allowMediumRisk}
                onChange={(e) => setP({ ...p, allowMediumRisk: e.target.checked })}
              />
              <div className="space-y-0.5">
                <span className="font-medium text-text block">Auto-fund medium-risk deals</span>
                <span className="text-xs text-muted block leading-snug">
                  Fund medium-risk deals without asking me (signals are still logged)
                </span>
              </div>
            </label>

            {/* Preview callout */}
            <div className="p-3.5 rounded-control border border-blue-200 bg-blue-50/60 text-xs text-blue-900 leading-relaxed flex items-start gap-2.5">
              <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <span className="font-bold block mb-0.5">Policy enforcement preview:</span>
                <p>
                  Deals up to ${p.approvalThreshold} fund without your tap when risk is Low
                  {p.allowMediumRisk ? " or Medium" : ""}; anything above that or riskier needs your
                  approval. Nothing over ${p.maxPerDeal} per deal or ${p.dailyCap} per day is ever
                  funded.
                </p>
              </div>
            </div>

            <ErrorNote error={error} />
            {saved && (
              <p role="status" className="text-xs font-bold text-success">
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
