"use client";

import { DEMO_PRESETS } from "@paylock/schemas";
import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Card, CardHeader, CardTitle } from "@/components/primitives/Card";
import { Field, Input, Select, Textarea } from "@/components/primitives/Field";
import { post, type DealView } from "@/lib/api";

type Act = (label: string, fn: () => Promise<unknown>) => Promise<void>;

export function DeliverForm({
  deal,
  busy,
  act,
}: {
  deal: DealView;
  busy: string | null;
  act: Act;
}) {
  const [kind, setKind] = useState<"url" | "text">("url");
  const [content, setContent] = useState("");
  const preset = DEMO_PRESETS.find((p) => p.seller === deal.seller.displayName && p.deliverable);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void act("deliver", () => post(`/deals/${deal.id}/deliverables`, { kind, content }));
  };

  return (
    <Card className="p-4 sm:p-5">
      <CardHeader className="mb-2">
        <CardTitle>Submit your work</CardTitle>
      </CardHeader>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <p className="text-xs text-muted">
          Funds are reserved in escrow. Paylock AI will review your deliverable against each
          contract criterion immediately upon submission.
        </p>

        {preset && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => {
                setKind("url");
                setContent(`${window.location.origin}/demo/deliverables/${preset.deliverable}`);
              }}
              data-testid="use-demo-deliverable"
              className="inline-flex items-center px-2.5 py-1 rounded-control text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors cursor-pointer"
            >
              Use the demo deliverable
            </button>
          </div>
        )}

        <Field id="deliverable-kind" label="Type">
          <Select
            id="deliverable-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "url" | "text")}
          >
            <option value="url">Hosted URL</option>
            <option value="text">Text / Code</option>
          </Select>
        </Field>

        <Field
          id="deliverable-content"
          label={kind === "url" ? "Deliverable URL" : "Deliverable content"}
        >
          {kind === "url" ? (
            <Input
              id="deliverable-content"
              type="url"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
              placeholder="https://..."
              data-testid="deliverable"
            />
          ) : (
            <Textarea
              id="deliverable-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
              placeholder="Paste work or output here..."
              data-testid="deliverable"
              rows={4}
            />
          )}
        </Field>

        <Button
          type="submit"
          disabled={!!busy || !content}
          loading={busy === "deliver"}
          data-testid="submit-deliverable"
          icon={<Send className="w-4 h-4" aria-hidden="true" />}
        >
          {busy === "deliver" ? "Submitting…" : "Submit for verification"}
        </Button>
      </form>
    </Card>
  );
}
