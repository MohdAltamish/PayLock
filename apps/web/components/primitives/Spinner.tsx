import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SpinnerProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function Spinner({ className, size = "md" }: SpinnerProps) {
  const sizeClasses = {
    sm: "w-3.5 h-3.5",
    md: "w-4 h-4",
    lg: "w-6 h-6",
  };

  return (
    <Loader2
      className={cn("animate-spin text-current", sizeClasses[size], className)}
      aria-hidden="true"
    />
  );
}

