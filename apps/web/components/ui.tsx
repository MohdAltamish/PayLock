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

export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
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
    <div className="min-h-screen flex flex-col overflow-x-clip bg-background text-text">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 min-h-[72px] py-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="flex items-center gap-2 text-[20px] font-extrabold text-accent hover:opacity-90"
            >
              <span className="flex items-center justify-center w-8 h-8 rounded-[10px] bg-accent text-white">
                <Lock className="w-4 h-4" aria-hidden="true" />
              </span>
              <span>Paylock</span>
              {isDemo && (
                <span className="ml-1 px-1.5 py-0.5 text-[11px] font-bold tracking-wide uppercase rounded bg-amber-50 text-amber-800 border border-amber-300">
                  Demo
                </span>
              )}
            </Link>
            <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
              <Link
                href="/deals"
                aria-current={pathname === "/deals" ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-[44px] items-center px-3.5 rounded-control text-[16px] font-bold transition-colors",
                  pathname === "/deals"
                    ? "bg-emerald-50 text-accent"
                    : "text-slate-700 hover:text-accent hover:bg-emerald-50",
                )}
              >
                Deals
              </Link>
              {me?.role === "buyer" && (
                <Link
                  href="/deals/new"
                  aria-current={pathname === "/deals/new" ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-[44px] items-center px-3.5 rounded-control text-[16px] font-bold transition-colors",
                    pathname === "/deals/new"
                      ? "bg-emerald-50 text-accent"
                      : "text-slate-700 hover:text-accent hover:bg-emerald-50",
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
                    "inline-flex min-h-[44px] items-center px-3.5 rounded-control text-[16px] font-bold transition-colors",
                    pathname === "/settings/policy"
                      ? "bg-emerald-50 text-accent"
                      : "text-slate-700 hover:text-accent hover:bg-emerald-50",
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
                <span className="text-[16px] font-bold text-text" data-testid="signed-in-as">
                  {me.displayName}
                </span>
                <span className="h-4 w-px bg-border" aria-hidden="true" />
                <button
                  type="button"
                  className="min-h-[44px] text-[15px] text-accent font-bold underline underline-offset-4 cursor-pointer"
                  onClick={async () => {
                    await post("/auth/logout");
                    window.location.href = "/";
                  }}
                >
                  Switch user
                </button>
              </>
            ) : me === null ? (
              <Link
                href="/"
                className="text-[16px] text-accent font-bold underline underline-offset-4"
              >
                Sign in
              </Link>
            ) : null}
          </div>
        </div>
      </header>
      <main
        id="main"
        className={cn("max-w-[1200px] mx-auto px-4 sm:px-6 w-full flex-1", wide ? "py-0" : "py-8")}
      >
        {children}
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-4 px-6 pb-10 pt-7 text-[16px] text-slate-700">
          <span className="font-bold text-accent">Paylock</span>
          <span>Runs in the PayPal sandbox. No real money moves.</span>
        </div>
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
