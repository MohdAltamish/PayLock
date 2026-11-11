import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { type Tone } from "@/lib/tone";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
}

const toneClasses: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
  accent: "bg-blue-50 text-blue-700 border-blue-200",
  success: "bg-emerald-50 text-emerald-800 border-emerald-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-red-50 text-red-800 border-red-200",
};

export function Badge({ tone = "neutral", icon, children, className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1 rounded-full text-[13px] font-bold border transition-colors",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {icon && (
        <span
          className="inline-flex shrink-0 w-3.5 h-3.5 items-center justify-center"
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <span>{children}</span>
    </span>
  );
}
