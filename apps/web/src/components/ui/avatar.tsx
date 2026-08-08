import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Deterministically map an identity to one of a small set of tints, so the same
 * person keeps the same colour across the app. Hue is derived from the string
 * rather than random so it survives reloads and server round-trips.
 */
const TINTS = [
  "bg-identity-1-bg text-identity-1",
  "bg-identity-2-bg text-identity-2",
  "bg-identity-3-bg text-identity-3",
  "bg-identity-4-bg text-identity-4",
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
  xs: "h-6 w-6 text-meta",
  sm: "h-8 w-8 text-meta",
  md: "h-10 w-10 text-ui",
  lg: "h-12 w-12 text-body",
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
        "inline-flex shrink-0 select-none items-center justify-center rounded-pill font-semibold",
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
