"use client";

import { DEMO_PRESETS } from "@paylock/schemas";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorNote, Shell } from "@/components/ui";
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
      <h1>New deal</h1>
      <form className="card" onSubmit={submit}>
        <p className="muted">Demo presets (recorded, so they always give the same result):</p>
        <div className="chips">
          {DEMO_PRESETS.map((p) => (
            <button
              type="button"
              key={p.key}
              onClick={() => preset(p)}
              data-testid={`preset-${p.key}`}
            >
              {p.label} · {p.seller}
            </button>
          ))}
        </div>
        <label>
          Seller
          <select
            value={sellerId}
            onChange={(e) => setSellerId(e.target.value)}
            data-testid="seller"
          >
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          What do you need done? Include your budget in USD.
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            required
            minLength={10}
            maxLength={4000}
            data-testid="request"
          />
        </label>
        <ErrorNote error={error} />
        <button
          type="submit"
          disabled={busy || !sellerId || request.length < 10}
          data-testid="create-deal"
        >
          {busy ? "Paylock AI is drafting the contract…" : "Draft the contract"}
        </button>
      </form>
    </Shell>
  );
}
