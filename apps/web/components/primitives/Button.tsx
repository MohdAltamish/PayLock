import Link, { type LinkProps } from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-text shadow-sm border border-transparent disabled:bg-slate-300 disabled:text-slate-500",
  secondary:
    "bg-surface text-text border border-border hover:bg-slate-50 hover:border-slate-300 shadow-sm disabled:bg-slate-50 disabled:text-slate-400",
  destructive:
    "bg-danger text-white hover:bg-danger-text shadow-sm border border-transparent disabled:bg-red-200 disabled:text-red-400",
  ghost:
    "bg-transparent text-muted hover:text-text hover:bg-slate-100 border border-transparent disabled:text-slate-400",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs min-h-[32px] gap-1.5",
  md: "px-3.5 py-2 text-sm min-h-[40px] gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    icon,
    disabled,
    children,
    className,
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      aria-busy={loading ? "true" : undefined}
      className={cn(
        "inline-flex items-center justify-center font-medium rounded-control transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed select-none",
        "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <>
          <Spinner size={size === "sm" ? "sm" : "md"} />
          {children}
        </>
      ) : (
        <>
          {icon && <span className="inline-flex shrink-0">{icon}</span>}
          {children}
        </>
      )}
    </button>
  );
});

export interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  icon,
  children,
  className,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={cn(
        "inline-flex items-center justify-center font-medium rounded-control transition-colors duration-150 select-none",
        "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      {children}
    </Link>
  );
}
