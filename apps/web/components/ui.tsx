"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { api, post, type DealView, type Me } from "@/lib/api";
import { MONEY_LABEL, STATE_LABEL } from "@/lib/copy";
import { cn } from "@/lib/cn";
import { getMoneyTone, getStateTone } from "@/lib/tone";
import { Badge } from "@/components/primitives/Badge";
import { Alert } from "@/components/primitives/Alert";

/** Money state is always visible, with text and icon (never color only). */
export function MoneyBadge({
  deal,
  className,
}: {
  deal: Pick<DealView, "moneyState" | "confirming">;
  className?: string;
}) {
  const label = deal.confirming
    ? "Confirming with PayPal…"
    : (MONEY_LABEL[deal.moneyState] ?? deal.moneyState);
  const { tone, icon: Icon } = getMoneyTone(deal.moneyState);

  return (
    <Badge
      tone={tone}
      role="status"
      data-testid="money-state"
      icon={<Icon className="w-3.5 h-3.5" aria-hidden="true" />}
      className={cn(`money-${deal.moneyState}`, className)}
    >
      {label}
    </Badge>
  );
}

export function StateBadge({ state, className }: { state: string; className?: string }) {
  const label = STATE_LABEL[state] ?? state;
  const { tone, icon: Icon } = getStateTone(state);

  return (
    <Badge
      tone={tone}
      data-testid="deal-state"
      icon={<Icon className="w-3.5 h-3.5" aria-hidden="true" />}
      className={cn(`state-${state}`, className)}
    >
      {label}
    </Badge>
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
  const pathname = usePathname();
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("demo") === "1") {
        sessionStorage.setItem("paylock_demo", "1");
        setIsDemo(true);
      } else if (sessionStorage.getItem("paylock_demo") === "1") {
        setIsDemo(true);
      }
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background text-text">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-surface/95 backdrop-blur-sm">
        <div className="max-w-[1120px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="flex items-center gap-2 font-semibold text-text hover:opacity-90"
            >
              <span className="flex items-center justify-center w-7 h-7 rounded-md bg-accent text-white">
                <Lock className="w-4 h-4" aria-hidden="true" />
              </span>
              <span>Paylock</span>
              {isDemo && (
                <span className="ml-1 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase rounded bg-amber-50 text-amber-800 border border-amber-300">
                  Demo
                </span>
              )}
            </Link>
            <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
              <Link
                href="/deals"
                aria-current={pathname === "/deals" ? "page" : undefined}
                className={cn(
                  "px-3 py-1.5 rounded-control text-sm font-medium transition-colors",
                  pathname === "/deals"
                    ? "bg-slate-100 text-text font-semibold"
                    : "text-muted hover:text-text hover:bg-slate-50",
                )}
              >
                Deals
              </Link>
              {me?.role === "buyer" && (
                <Link
                  href="/deals/new"
                  aria-current={pathname === "/deals/new" ? "page" : undefined}
                  className={cn(
                    "px-3 py-1.5 rounded-control text-sm font-medium transition-colors",
                    pathname === "/deals/new"
                      ? "bg-slate-100 text-text font-semibold"
                      : "text-muted hover:text-text hover:bg-slate-50",
                  )}
                >
                  New deal
                </Link>
              )}
              {me?.role === "buyer" && (
                <Link
                  href="/settings/policy"
                  aria-current={pathname === "/settings/policy" ? "page" : undefined}
                  className={cn(
                    "px-3 py-1.5 rounded-control text-sm font-medium transition-colors",
                    pathname === "/settings/policy"
                      ? "bg-slate-100 text-text font-semibold"
                      : "text-muted hover:text-text hover:bg-slate-50",
                  )}
                >
                  Spend policy
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {me ? (
              <>
                <span className="text-sm font-medium text-text" data-testid="signed-in-as">
                  {me.displayName}
                </span>
                <span className="h-4 w-px bg-border" aria-hidden="true" />
                <button
                  type="button"
                  className="text-xs text-muted hover:text-text font-medium underline underline-offset-4 cursor-pointer"
                  onClick={async () => {
                    await post("/auth/logout");
                    window.location.href = "/";
                  }}
                >
                  Switch user
                </button>
              </>
            ) : me === null ? (
              <Link href="/" className="text-sm text-accent font-medium hover:underline">
                Sign in
              </Link>
            ) : null}
          </div>
        </div>
      </header>
      <main id="main" className="max-w-[1120px] mx-auto px-4 sm:px-6 py-6 w-full flex-1">
        {children}
      </main>
      <footer className="py-8 text-center text-xs text-muted border-t border-border/50">
        PayPal sandbox only. No real money moves.
      </footer>
    </div>
  );
}

export function ErrorNote({ error, className }: { error: string | null; className?: string }) {
  if (!error) return null;
  return (
    <Alert variant="danger" className={cn("mt-2", className)}>
      {error}
    </Alert>
  );
}
