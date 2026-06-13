import { cn } from "../lib/utils.js";

interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <img
      aria-hidden="true"
      alt=""
      className={cn("block h-9 w-9 rounded-xl object-contain", className)}
      src="/images/qqueue-favicon.png"
    />
  );
}
