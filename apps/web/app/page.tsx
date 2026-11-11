"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BadgeCheck, Lock, ScanSearch } from "lucide-react";
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

  const steps = [
    {
      n: "Step 1",
      title: "Agree the contract",
      body: "Buyer and seller agree on clear acceptance criteria before any money is involved.",
      tone: "evergreen",
    },
    {
      n: "Step 2",
      title: "Check the risk",
      body: "Paylock checks risk signals and your spend policy before anyone pays.",
      tone: "evergreen",
    },
    {
      n: "Step 3",
      title: "Lock the money",
      body: "Funds are reserved with a PayPal authorization, not sent.",
      tone: "held",
    },
    {
      n: "Step 4",
      title: "Release on proof",
      body: "Paylock AI checks the delivery against each criterion. Pass: the seller is paid. Fail: the funds return.",
      tone: "held",
    },
  ] as const;

  return (
    <Shell wide>
      <section className="grid items-center gap-14 pb-[72px] pt-8 sm:pt-14 md:grid-cols-2">
        <div className="flex flex-col gap-[22px]">
          <h1 className="text-[clamp(40px,5.2vw,68px)] font-extrabold leading-[1.04] tracking-[-0.025em] text-text">
            AI escrow that pays on proof.
          </h1>
          <p className="max-w-[34rem] text-[21px] leading-normal text-slate-700">
            Paylock reserves the buyer&apos;s money with PayPal, checks risk signals before anyone
            pays, verifies the work against the contract, and releases payment only when the work is
            proven.
          </p>

          <div id="persona-picker" className="mt-1.5 flex flex-col gap-3 scroll-mt-24">
            <ErrorNote error={error} />
            <div className="grid max-w-[30rem] gap-3">
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => login(u)}
                  data-testid={`login-${u.displayName.replaceAll(" ", "-")}`}
                  className={
                    u.role === "buyer"
                      ? "inline-flex min-h-[58px] w-full cursor-pointer items-center justify-center gap-2 rounded-control border-2 border-transparent bg-accent px-5 text-[19px] font-bold text-white transition-transform hover:bg-accent-text active:scale-[0.98]"
                      : "inline-flex min-h-[58px] w-full cursor-pointer items-center justify-center gap-2 rounded-control border-2 border-accent bg-surface px-5 text-[19px] font-bold text-accent transition-transform hover:bg-emerald-50 active:scale-[0.98]"
                  }
                >
                  Try as {u.displayName}
                  <span className="text-[15px] font-medium opacity-80">({u.role})</span>
                </button>
              ))}
            </div>
            <p className="text-[16px] text-muted">
              No sign-up. PayPal sandbox only. Use the sandbox buyer account in the PayPal window.{" "}
              <Link href="/deals" className="font-bold text-accent underline underline-offset-4">
                See a demo deal
              </Link>
            </p>
          </div>
        </div>

        <div className="flex justify-center" aria-hidden="true">
          <div className="flex w-[320px] max-w-full flex-col items-center gap-3.5 rounded-[40px] bg-surface px-6 pb-[30px] pt-7 shadow-[0_24px_60px_-12px_rgba(20,32,27,0.18),0_2px_6px_rgba(20,32,27,0.06)]">
            <div className="relative mx-auto h-[228px] w-[228px]">
              <svg viewBox="0 0 228 228" className="h-full w-full -rotate-90">
                <circle
                  cx="114"
                  cy="114"
                  r="100"
                  fill="none"
                  stroke="var(--color-blue-100)"
                  strokeWidth="14"
                />
                <circle
                  cx="114"
                  cy="114"
                  r="100"
                  fill="none"
                  stroke="var(--color-blue-600)"
                  strokeWidth="14"
                  strokeLinecap="round"
                  strokeDasharray="628"
                  strokeDashoffset="160"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                <Lock className="h-6 w-6 text-blue-600" />
                <span className="text-[44px] font-extrabold leading-none tracking-[-0.02em] tabular-nums">
                  $1,200
                </span>
                <span className="text-[17px] font-bold text-blue-600">Reserved</span>
              </div>
            </div>
            <span className="text-center text-[20px] font-extrabold leading-tight">
              The seller is paid when the work is proven
            </span>
            <span className="text-center text-[16px] leading-snug text-slate-700">
              3 of 4 acceptance criteria verified by Paylock AI.
            </span>
            <div className="mt-1 flex w-full flex-col gap-2">
              {["Logo in SVG and PNG", "Three colour variants", "Brand guide PDF"].map((c) => (
                <span
                  key={c}
                  className="flex items-center gap-2 rounded-control bg-emerald-50 px-3 py-2 text-[15px] font-bold text-emerald-800"
                >
                  <BadgeCheck className="h-4 w-4 shrink-0" />
                  {c}
                </span>
              ))}
              <span className="flex items-center gap-2 rounded-control bg-slate-100 px-3 py-2 text-[15px] font-bold text-slate-700">
                <ScanSearch className="h-4 w-4 shrink-0" />
                Source files: checking
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-[calc(50%-50vw)] bg-surface">
        <div className="mx-auto max-w-[1200px] px-6 py-16">
          <h2 className="text-[32px] font-extrabold leading-tight tracking-[-0.01em]">
            How a payment is protected
          </h2>
          <ol className="mt-8 grid list-none gap-7 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <li
                key={s.title}
                className={`flex flex-col gap-2.5 border-t-[3px] pt-[18px] ${s.tone === "held" ? "border-blue-600" : "border-accent"}`}
              >
                <span
                  className={`text-[16px] font-extrabold ${s.tone === "held" ? "text-blue-600" : "text-accent"}`}
                >
                  {s.n}
                </span>
                <span className="text-[21px] font-extrabold">{s.title}</span>
                <span className="text-[17px] leading-normal text-slate-700">{s.body}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="grid items-start gap-10 py-16 md:grid-cols-2">
        <p className="text-[clamp(28px,3.4vw,40px)] font-extrabold leading-[1.2] tracking-[-0.01em]">
          Money moves only when the work is proven.
        </p>
        <p className="text-[19px] leading-[1.55] text-slate-700">
          Every capture, payout and refund is tied to a stored decision and a policy check. If
          Paylock AI is unsure, a person reviews the work before anything is released.
        </p>
      </section>
    </Shell>
  );
}
