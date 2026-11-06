"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorNote, Shell, StateBadge } from "@/components/ui";
import { Card } from "@/components/primitives/Card";
import { ButtonLink } from "@/components/primitives/Button";
import { api } from "@/lib/api";

interface Row {
  id: string;
  state: string;
  amount: string;
  title: string | null;
  buyer: string;
  seller: string;
  role: "buyer" | "seller";
  createdAt: string;
}

export default function Deals() {
  const [deals, setDeals] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ deals: Row[] }>("/deals").then(
      (r) => setDeals(r.deals),
      (e: Error) => setError(e.message),
    );
  }, []);

  return (
    <Shell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Deals</h1>
        <ErrorNote error={error} />
        {deals && deals.length === 0 && (
          <Card className="space-y-3">
            <p className="text-sm text-muted">No deals yet.</p>
            <ButtonLink href="/deals/new">Create your first deal</ButtonLink>
          </Card>
        )}
        {deals && deals.length > 0 && (
          <Card className="p-0 overflow-hidden">
            <ul className="divide-y divide-border">
              {deals.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="space-y-1">
                    <Link
                      href={`/deals/${d.id}`}
                      className="text-sm font-semibold text-text hover:text-accent hover:underline"
                    >
                      {d.title ?? "Untitled"}
                    </Link>
                    <p className="text-xs text-muted">
                      {d.role === "buyer" ? `with ${d.seller}` : `for ${d.buyer}`} ·{" "}
                      {new Date(d.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums text-text">
                      ${d.amount}
                    </span>
                    <StateBadge state={d.state} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Shell>
  );
}
