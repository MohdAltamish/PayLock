"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorNote, Shell } from "@/components/ui";
import { Button } from "@/components/primitives/Button";
import { Card } from "@/components/primitives/Card";
import { api, post } from "@/lib/api";

interface DemoUser {
  id: string;
  displayName: string;
  role: "buyer" | "seller";
}

/** Landing page with the demo persona picker (demo sessions, no passwords). */
export default function Landing() {
  const router = useRouter();
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ users: DemoUser[] }>("/auth/demo-users").then(
      (r) => setUsers(r.users),
      () => setError("The Paylock API is not reachable.")
    );
  }, []);

  const login = async (u: DemoUser) => {
    try {
      await post("/auth/demo-login", { userId: u.id });
      router.push(u.role === "buyer" ? "/deals/new" : "/deals");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Shell>
      <section className="py-6 sm:py-8 space-y-3">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-text">
          AI escrow that pays on proof.
        </h1>
        <p className="text-base sm:text-lg text-muted max-w-2xl leading-relaxed">
          Paylock reserves the buyer&apos;s money with PayPal, checks risk signals before anyone
          pays, verifies the work against the contract, and releases payment only when the work is
          proven.
        </p>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-6">
        <Card>
          <h2 className="text-base font-semibold mb-1 text-text">1. Lock</h2>
          <p className="text-sm text-muted">
            Funds are reserved with a PayPal authorization, not sent.
          </p>
        </Card>
        <Card>
          <h2 className="text-base font-semibold mb-1 text-text">2. Verify</h2>
          <p className="text-sm text-muted">
            Paylock AI checks the delivery against each acceptance criterion.
          </p>
        </Card>
        <Card>
          <h2 className="text-base font-semibold mb-1 text-text">3. Release</h2>
          <p className="text-sm text-muted">
            Pass: the seller is paid. Fail: the reservation is cancelled and funds return.
          </p>
        </Card>
      </div>

      <Card className="space-y-4 my-6">
        <h2 className="text-base font-semibold text-text">Try the demo: sign in as</h2>
        <ErrorNote error={error} />
        <div className="flex flex-wrap gap-2.5">
          {users.map((u) => (
            <Button
              key={u.id}
              variant={u.role === "buyer" ? "primary" : "secondary"}
              onClick={() => login(u)}
              data-testid={`login-${u.displayName.replaceAll(" ", "-")}`}
            >
              <span>{u.displayName}</span>{" "}
              <span className={u.role === "buyer" ? "text-white" : "text-muted"}>({u.role})</span>
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted">
          PayPal sandbox only. Use the sandbox buyer account in the PayPal window.
        </p>
      </Card>
    </Shell>
  );
}
