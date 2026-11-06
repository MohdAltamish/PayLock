import { cn } from "@/lib/cn";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-control bg-slate-200/80 transition-opacity duration-200",
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  );
}
