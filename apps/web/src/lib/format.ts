/**
 * Shared display formatting. Centralised so a date reads the same way on every
 * screen — inconsistent timestamps are one of the fastest ways to make an app
 * feel like several apps stitched together.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Mail-client timestamp: the time for today, a weekday within the last week,
 * a day and month this year, and a full date beyond that. Optimised for
 * scanning a list, where "23 Nov 2025, 14:03" is noise on every row.
 */
export function formatMailDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const age = now.getTime() - date.getTime();
  if (age > 0 && age < 6 * DAY) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  }

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * A fixed calendar stamp — "Aug 6, 9:45 AM".
 *
 * For tables whose rows span days, where `formatMailDate`'s relative labels
 * ("Wed", "6 Aug") stop being comparable down a column. Rendered inside a
 * `<time>` so it picks up tabular figures and the digits line up between rows.
 */
export function formatTimestamp(
  value: string | Date | null | undefined,
  fallback = "—"
): string {
  const date = toDate(value);
  if (!date) return fallback;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The unabbreviated form, for tooltips and detail headers. */
export function formatFullDate(
  value: string | Date | null | undefined,
  fallback = "Never"
): string {
  const date = toDate(value);
  return date ? date.toLocaleString() : fallback;
}

/** "2 minutes ago" / "in 3 hours", for activity feeds and relative deadlines. */
export function formatRelative(
  value: string | Date | null | undefined,
  fallback = "—"
): string {
  const date = toDate(value);
  if (!date) return fallback;

  const delta = date.getTime() - Date.now();
  const absolute = Math.abs(delta);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (absolute < MINUTE) return formatter.format(Math.round(delta / 1000), "second");
  if (absolute < HOUR) return formatter.format(Math.round(delta / MINUTE), "minute");
  if (absolute < DAY) return formatter.format(Math.round(delta / HOUR), "hour");
  if (absolute < 30 * DAY) return formatter.format(Math.round(delta / DAY), "day");
  return date.toLocaleDateString();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Thousands separators, so a five-figure recipient count stays readable. */
export function formatCount(value: number): string {
  return value.toLocaleString();
}

/** A ratio in 0..1 as a percentage with one decimal, e.g. `0.9234` → `92.3%`. */
export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}
