import { type HTMLAttributes, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/cn";

export type AlertVariant = "danger" | "warning" | "info" | "success";

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
}

const variantConfig: Record<
  AlertVariant,
  { bg: string; border: string; text: string; defaultIcon: ReactNode }
> = {
  danger: {
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-800",
    defaultIcon: (
      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
    ),
  },
  warning: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-800",
    defaultIcon: (
      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
    ),
  },
  info: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-800",
    defaultIcon: <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" aria-hidden="true" />,
  },
  success: {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-800",
    defaultIcon: (
      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
    ),
  },
};

export function Alert({
  variant = "danger",
  title,
  icon,
  children,
  className,
  ...props
}: AlertProps) {
  const config = variantConfig[variant];
  const role = variant === "danger" ? "alert" : "status";

  return (
    <div
      role={role}
      className={cn(
        "flex gap-3 p-3 sm:p-4 rounded-control border text-sm",
        config.bg,
        config.border,
        config.text,
        className,
      )}
      {...props}
    >
      {icon ?? config.defaultIcon}
      <div className="space-y-1">
        {title && <h4 className="font-bold leading-tight">{title}</h4>}
        <div className="text-sm opacity-90">{children}</div>
      </div>
    </div>
  );
}
