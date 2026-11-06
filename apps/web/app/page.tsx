"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorNote, Shell } from "@/components/ui";
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
      () => setError("The Paylock API is not reachable."),
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
      <section className="hero">
        <h1>AI escrow that pays on proof.</h1>
        <p>
          Paylock reserves the buyer&apos;s money with PayPal, checks risk signals before anyone
          pays, verifies the work against the contract, and releases payment only when the work is
          proven.
        </p>
      </section>
      <div className="steps">
        <div className="card">
          <h2>1. Lock</h2>
          <p className="muted">Funds are reserved with a PayPal authorization, not sent.</p>
        </div>
        <div className="card">
          <h2>2. Verify</h2>
          <p className="muted">Paylock AI checks the delivery against each acceptance criterion.</p>
        </div>
        <div className="card">
          <h2>3. Release</h2>
          <p className="muted">
            Pass: the seller is paid. Fail: the reservation is cancelled and funds return.
          </p>
        </div>
      </div>
      <section className="card">
        <h2>Try the demo: sign in as</h2>
        <ErrorNote error={error} />
        <div className="row">
          {users.map((u) => (
            <button
              key={u.id}
              className={u.role === "buyer" ? undefined : "secondary"}
              onClick={() => login(u)}
              data-testid={`login-${u.displayName.replaceAll(" ", "-")}`}
            >
              {u.displayName} <span className="muted">({u.role})</span>
            </button>
          ))}
        </div>
        <p className="muted">
          PayPal sandbox only. Use the sandbox buyer account in the PayPal window.
        </p>
      </section>
    </Shell>
  );
}
