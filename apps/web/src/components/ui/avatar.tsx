import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Deterministically map an identity to one of a small set of tints, so the same
 * person keeps the same colour across the app. Hue is derived from the string
 * rather than random so it survives reloads and server round-trips.
 */
const TINTS = [
  "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
] as const;

function tintFor(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return TINTS[Math.abs(hash) % TINTS.length];
}

function initialsFor(name: string) {
  const cleaned = name.trim();
  if (!cleaned) return "?";
  // An email address has no useful second word — take the first two letters of
  // the local part instead of the domain.
  if (cleaned.includes("@")) {
    return cleaned.slice(0, 2).toUpperCase();
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

const SIZES = {
  xs: "h-6 w-6 text-[0.6rem]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
} as const;

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Display name or email — drives both the initials and the tint. */
  name: string;
  size?: keyof typeof SIZES;
  /** Overrides the derived initials (e.g. an organization's first letter). */
  initials?: string;
}

export function Avatar({
  name,
  size = "md",
  initials,
  className,
  ...props
}: AvatarProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold",
        SIZES[size],
        tintFor(name || "?"),
        className
      )}
      {...props}
    >
      {initials ?? initialsFor(name)}
    </span>
  );
}

export { initialsFor, tintFor };
