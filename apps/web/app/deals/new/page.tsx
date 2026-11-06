"use client";

import { DEMO_PRESETS } from "@paylock/schemas";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorNote, Shell, useMe } from "@/components/ui";
import { Stepper } from "@/components/deal/Stepper";
import { Alert } from "@/components/primitives/Alert";
import { Button } from "@/components/primitives/Button";
import { Card } from "@/components/primitives/Card";
import { Field, Select, Textarea } from "@/components/primitives/Field";
import { api, post } from "@/lib/api";

interface DemoUser {
  id: string;
  displayName: string;
  role: "buyer" | "seller";
}

/** Step 1: describe the job. The contract, risk check and funding follow on the deal page. */
export default function NewDeal() {
  const router = useRouter();
  const me = useMe();
  const [sellers, setSellers] = useState<DemoUser[]>([]);
  const [sellerId, setSellerId] = useState("");
  const [request, setRequest] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ users: DemoUser[] }>("/auth/demo-users").then((r) => {
      const s = r.users.filter((u) => u.role === "seller");
      setSellers(s);
      setSellerId((cur) => cur || s[0]?.id || "");
    });
  }, []);

  const preset = (p: (typeof DEMO_PRESETS)[number]) => {
    setRequest(p.request);
    const s = sellers.find((x) => x.displayName === p.seller);
    if (s) setSellerId(s.id);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await post<{ id: string }>("/deals", { sellerId, request });
      router.push(`/deals/${d.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const validationError =
    touched && request.length > 0 && request.length < 10
      ? "Please describe the task in at least 10 characters."
      : null;

  return (
    <Shell>
      <div className="max-w-2xl mx-auto space-y-6">
        <Stepper currentStep={1} />

        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-text">New deal</h1>
          <p className="text-xs sm:text-sm text-muted">
            Step 1: Describe the requirements and budget. Paylock AI will structure the contract.
          </p>
        </div>

        <Card>
          {me?.role === "seller" && (
            <Alert variant="warning" title="Buyer account required" className="mb-5">
              You are signed in as a seller (<strong>{me.displayName}</strong>). In Paylock, only
              buyers set spend policies and draft deals. Please click <strong>Switch user</strong> in
              the top right to select a buyer account.
            </Alert>
          )}

          <form className="space-y-5" onSubmit={submit}>
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                Demo presets:
              </p>
              <div className="flex flex-wrap gap-2">
                {DEMO_PRESETS.map((p) => (
                  <button
                    type="button"
                    key={p.key}
                    onClick={() => preset(p)}
                    data-testid={`preset-${p.key}`}
                    className="inline-flex items-center px-3 py-1.5 rounded-control text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200 hover:bg-slate-200 hover:border-slate-300 transition-colors cursor-pointer"
                  >
                    {p.label} · {p.seller}
                  </button>
                ))}
              </div>
            </div>

            <Field id="seller-select" label="Seller">
              <Select
                id="seller-select"
                value={sellerId}
                onChange={(e) => setSellerId(e.target.value)}
                data-testid="seller"
              >
                {sellers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              id="request-textarea"
              label="What do you need done? Include your budget in USD."
              error={validationError}
            >
              <Textarea
                id="request-textarea"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                onBlur={() => setTouched(true)}
                required
                minLength={10}
                maxLength={4000}
                data-testid="request"
                rows={5}
                placeholder="e.g. Build an authentication flow with OAuth2 for $400 USD..."
              />
              <div className="flex justify-end mt-1">
                <span className="text-[11px] text-muted tabular-nums">
                  {request.length} / 4000 characters
                </span>
              </div>
            </Field>

            <ErrorNote error={error} />

            {/* CTA sticks to the bottom on mobile */}
            <div className="pt-2 sticky bottom-4 sm:static z-10 bg-surface/90 sm:bg-transparent backdrop-blur-xs sm:backdrop-blur-none p-2 sm:p-0 rounded-control border sm:border-0 border-border/80 sm:shadow-none shadow-lg">
              <Button
                type="submit"
                disabled={busy || !sellerId || request.length < 10 || me?.role === "seller"}
                loading={busy}
                data-testid="create-deal"
                className="w-full sm:w-auto"
              >
                {busy
                  ? "Paylock AI is drafting the contract…"
                  : me?.role === "seller"
                    ? "Buyer account required"
                    : "Draft the contract"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </Shell>
  );
}
