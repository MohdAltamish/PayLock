"use client";

import { DEMO_PRESETS } from "@paylock/schemas";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorNote, Shell } from "@/components/ui";
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
  const [sellers, setSellers] = useState<DemoUser[]>([]);
  const [sellerId, setSellerId] = useState("");
  const [request, setRequest] = useState("");
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

  return (
    <Shell>
      <div className="max-w-2xl mx-auto space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-text">New deal</h1>
        <Card>
          <form className="space-y-5" onSubmit={submit}>
            <div>
              <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
                Demo presets (recorded, so they always give the same result):
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

            <Field id="request-textarea" label="What do you need done? Include your budget in USD.">
              <Textarea
                id="request-textarea"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                required
                minLength={10}
                maxLength={4000}
                data-testid="request"
                rows={5}
              />
            </Field>

            <ErrorNote error={error} />

            <Button
              type="submit"
              disabled={busy || !sellerId || request.length < 10}
              loading={busy}
              data-testid="create-deal"
            >
              {busy ? "Paylock AI is drafting the contract…" : "Draft the contract"}
            </Button>
          </form>
        </Card>
      </div>
    </Shell>
  );
}
