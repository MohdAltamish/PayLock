"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorNote, Shell, StateBadge } from "@/components/ui";
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
      <h1>Deals</h1>
      <ErrorNote error={error} />
      {deals && deals.length === 0 && (
        <section className="card">
          <p>No deals yet.</p>
          <Link className="button" href="/deals/new">
            Create your first deal
          </Link>
        </section>
      )}
      {deals && deals.length > 0 && (
        <ul className="list card">
          {deals.map((d) => (
            <li key={d.id}>
              <span>
                <Link href={`/deals/${d.id}`}>{d.title ?? "Untitled"}</Link>
                <br />
                <span className="muted">
                  {d.role === "buyer" ? `with ${d.seller}` : `for ${d.buyer}`} ·{" "}
                  {new Date(d.createdAt).toLocaleString()}
                </span>
              </span>
              <span className="row">
                <strong>${d.amount}</strong> <StateBadge state={d.state} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
