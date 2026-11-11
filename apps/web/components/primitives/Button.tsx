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
    "bg-accent text-white hover:bg-accent-text border-2 border-transparent disabled:bg-slate-300 disabled:text-slate-500",
  secondary:
    "bg-surface text-accent border-2 border-accent hover:bg-emerald-50 disabled:bg-slate-50 disabled:text-slate-400",
  destructive:
    "bg-danger text-white hover:bg-danger-text border-2 border-transparent disabled:bg-red-200 disabled:text-red-400",
  ghost:
    "bg-transparent text-muted hover:text-text hover:bg-emerald-50 border-2 border-transparent disabled:text-slate-400",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3.5 py-1.5 text-[14px] min-h-[38px] gap-1.5",
  md: "px-5 py-2.5 text-[16px] min-h-[48px] gap-2",
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
        "inline-flex items-center justify-center font-bold rounded-control transition-[color,background-color,transform] duration-150 active:scale-[0.98] cursor-pointer disabled:cursor-not-allowed select-none",
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
        "inline-flex items-center justify-center font-bold rounded-control transition-[color,background-color,transform] duration-150 active:scale-[0.98] select-none",
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
