"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api, post, type DealView, type Me } from "@/lib/api";
import { MONEY_LABEL, STATE_LABEL } from "@/lib/copy";

const MONEY_ICON: Record<string, string> = {
  none: "○",
  reserving: "◔",
  reserved: "🔒",
  releasing: "◑",
  released: "✓",
  returned: "↩",
  attention: "!",
};

/** Money state is always visible, with text and icon (never color only). */
export function MoneyBadge({ deal }: { deal: Pick<DealView, "moneyState" | "confirming"> }) {
  const label = deal.confirming ? "Confirming with PayPal…" : MONEY_LABEL[deal.moneyState];
  return (
    <span className={`badge money-${deal.moneyState}`} role="status" data-testid="money-state">
      <span aria-hidden="true">{MONEY_ICON[deal.moneyState]}</span> {label}
    </span>
  );
}

export function StateBadge({ state }: { state: string }) {
  return (
    <span className={`badge state-${state}`} data-testid="deal-state">
      {STATE_LABEL[state] ?? state}
    </span>
  );
}

export function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    api<Me>("/auth/me").then(setMe, () => setMe(null));
  }, []);
  return me;
}

export function Shell({ children }: { children: ReactNode }) {
  const me = useMe();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          <span aria-hidden="true">🔒</span> Paylock
        </Link>
        <nav aria-label="Main">
          <Link href="/deals">Deals</Link>
          {me?.role === "buyer" && <Link href="/deals/new">New deal</Link>}
          {me?.role === "buyer" && <Link href="/settings/policy">Spend policy</Link>}
        </nav>
        <div className="who">
          {me ? (
            <>
              <span data-testid="signed-in-as">{me.displayName}</span>
              <button
                className="link"
                onClick={async () => {
                  await post("/auth/logout");
                  window.location.href = "/";
                }}
              >
                Switch user
              </button>
            </>
          ) : me === null ? (
            <Link href="/">Sign in</Link>
          ) : null}
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="foot">PayPal sandbox only. No real money moves.</footer>
    </>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {error}
    </p>
  );
}
