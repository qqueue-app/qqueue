import { cn } from "../lib/utils.js";

interface BrandWordmarkProps {
  className?: string;
}

export function BrandWordmark({ className }: BrandWordmarkProps) {
  return (
    <>
      <img
        alt="QQueue"
        className={cn("block h-8 w-auto dark:hidden", className)}
        height="429"
        src="/images/qqueue-wordmark-light-transparent.png"
        width="1351"
      />
      <img
        alt="QQueue"
        className={cn("hidden h-8 w-auto dark:block", className)}
        height="408"
        src="/images/qqueue-wordmark-dark-transparent.png"
        width="1243"
      />
    </>
  );
}
