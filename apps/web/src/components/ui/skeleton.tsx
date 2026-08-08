import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-control bg-surface-sunken", className)}
      {...props}
    />
  );
}

export { Skeleton };
