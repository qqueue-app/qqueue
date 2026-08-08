import { formatCount } from "../lib/format.js";
import { cn } from "../lib/utils.js";
import { Card } from "./ui/card.js";
import { Skeleton } from "./ui/skeleton.js";

interface StatCardProps {
  /** What the number counts. 13px, secondary — the value is the headline. */
  label: string;
  value: number;
  /** The one line under the value that says what it means. */
  context: string;
  /**
   * A stat that is bad news the moment it isn't zero (Failed). The *value*
   * turns red, and only then — §3 rules out carrying that signal on an icon,
   * because an icon that is always there says nothing when it matters.
   */
  alarmWhenNonZero?: boolean;
  loading?: boolean;
}

/**
 * Dashboard stat card: label, number, context line. That's the whole card.
 *
 * There is deliberately no corner icon. A tinted square holding a generic
 * envelope next to the word "Emails today" is decoration — it repeats the
 * label in a form you can't read, and six of them turn a quiet grid into a
 * dashboard template (§6, anti-pattern 6).
 */
export function StatCard({
  label,
  value,
  context,
  alarmWhenNonZero = false,
  loading = false,
}: StatCardProps) {
  const alarming = alarmWhenNonZero && value > 0;

  return (
    <Card className="p-6">
      <div className="text-ui text-text-secondary">{label}</div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-16" />
      ) : (
        <div
          data-numeric
          className={cn(
            "mt-2 text-stat font-semibold",
            alarming ? "text-err" : "text-text"
          )}
        >
          {formatCount(value)}
        </div>
      )}
      {/*
        The context line waits for the data too. It is derived from the value
        ("Nothing failed today"), so rendering it beside a placeholder would be
        the card stating a fact it does not have yet.
      */}
      {loading ? (
        <Skeleton className="mt-1 h-4 w-32" />
      ) : (
        <div className="mt-1 truncate text-meta text-text-tertiary">
          {context}
        </div>
      )}
    </Card>
  );
}
