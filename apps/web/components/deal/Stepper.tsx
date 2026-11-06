"use client";

import { Check } from "lucide-react";
import { WIZARD_STEPS, type WizardStep } from "@/lib/wizard";
import { cn } from "@/lib/cn";

export function Stepper({ currentStep }: { currentStep: WizardStep }) {
  if (!currentStep) return null;

  return (
    <nav aria-label="Progress" className="mb-6">
      <ol className="flex items-center justify-between w-full max-w-xl mx-auto px-2">
        {WIZARD_STEPS.map((s, idx) => {
          const isCurrent = s.step === currentStep;
          const isCompleted = s.step < currentStep;

          return (
            <li
              key={s.step}
              className={cn(
                "flex-1 flex items-center",
                idx < WIZARD_STEPS.length - 1 &&
                  "after:content-[''] after:w-full after:h-px after:bg-border after:inline-block after:mx-3",
              )}
            >
              <div
                className="flex items-center gap-2"
                aria-current={isCurrent ? "step" : undefined}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                    isCurrent
                      ? "bg-accent text-white ring-2 ring-accent/30 ring-offset-2"
                      : isCompleted
                        ? "bg-emerald-50 text-emerald-800 border border-emerald-300"
                        : "bg-slate-100 text-muted border border-border",
                  )}
                >
                  {isCompleted ? (
                    <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                  ) : (
                    s.step
                  )}
                </span>
                <span
                  className={cn(
                    "text-xs whitespace-nowrap",
                    isCurrent ? "font-semibold text-text" : "font-medium text-muted",
                  )}
                >
                  {s.label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
