"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BadgeCheck, Lock, ScanSearch } from "lucide-react";
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
      <section className="py-8 sm:py-12 space-y-5">
        <div className="space-y-3 max-w-2xl">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-text">
            AI escrow that pays on proof.
          </h1>
          <p className="text-base sm:text-lg text-muted leading-relaxed">
            Paylock reserves the buyer&apos;s money with PayPal, checks risk signals before anyone
            pays, verifies the work against the contract, and releases payment only when the work is
            proven.
          </p>
        </div>
        <div className="flex items-center gap-4 pt-2">
          <Button
            size="md"
            onClick={() => {
              const el = document.getElementById("persona-picker");
              el?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Try the demo
          </Button>
          <Link
            href="/deals"
            className="text-sm text-muted hover:text-text font-medium underline underline-offset-4"
          >
            See a demo deal
          </Link>
        </div>
      </section>

      {/* Connected strip: Lock, Verify, Release */}
      <div className="rounded-card border border-border bg-surface shadow-card divide-y md:divide-y-0 md:divide-x divide-border grid grid-cols-1 md:grid-cols-3 my-6">
        <div className="p-5 flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-blue-50 text-accent">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-text">1. Lock</h2>
            <p className="text-xs text-muted leading-relaxed">
              Funds are reserved with a PayPal authorization, not sent.
            </p>
          </div>
        </div>

        <div className="p-5 flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-blue-50 text-accent">
            <ScanSearch className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-text">2. Verify</h2>
            <p className="text-xs text-muted leading-relaxed">
              Paylock AI checks the delivery against each acceptance criterion.
            </p>
          </div>
        </div>

        <div className="p-5 flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-emerald-50 text-emerald-600">
            <BadgeCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-text">3. Release</h2>
            <p className="text-xs text-muted leading-relaxed">
              Pass: the seller is paid. Fail: the reservation is cancelled and funds return.
            </p>
          </div>
        </div>
      </div>

      {/* Persona picker card */}
      <Card id="persona-picker" className="space-y-4 my-8 scroll-mt-24">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-text">Try the demo: sign in as</h2>
          <p className="text-xs text-muted">
            Select a demo persona to test the buyer and seller escrow workflows.
          </p>
        </div>
        <ErrorNote error={error} />
        <div className="flex flex-wrap gap-2.5 pt-1">
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
        <p className="text-xs text-muted pt-2 border-t border-border/60">
          PayPal sandbox only. Use the sandbox buyer account in the PayPal window.
        </p>
      </Card>
    </Shell>
  );
}
