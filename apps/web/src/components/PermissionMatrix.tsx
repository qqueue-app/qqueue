import { Check, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Avatar } from "./ui/avatar.js";
import { Hint } from "./ui/tooltip.js";

export interface MatrixColumn {
  id: string;
  /** Short header label, e.g. the mailbox address. */
  label: string;
  /** Longer description shown in the header tooltip. */
  hint?: string;
}

export interface MatrixRow {
  id: string;
  name: string;
  secondary?: string;
  /**
   * Rows that hold the permission unconditionally — an owner or admin may send
   * as any of the organization's accounts. Rendered as a locked "always" mark
   * rather than a ticked checkbox, because unticking it would do nothing.
   */
  alwaysAllowed?: boolean;
  alwaysAllowedReason?: string;
}

export interface PermissionMatrixProps {
  rows: MatrixRow[];
  columns: MatrixColumn[];
  /** True when `rowId` currently holds the permission for `columnId`. */
  isGranted: (rowId: string, columnId: string) => boolean;
  onToggle: (rowId: string, columnId: string, next: boolean) => void;
  /** Cells mid-flight, keyed `${rowId}:${columnId}`, so each shows its own spinner. */
  pending?: Set<string>;
  disabled?: boolean;
  /** Column-header noun, e.g. "sending account". Used in accessible labels. */
  columnNoun: string;
  emptyMessage?: string;
}

/**
 * A people × permissions grid.
 *
 * Replaces the usual "pick a person, press Grant, watch a chip appear" loop:
 * the whole access picture is visible at once, and changing it is one click in
 * the cell where the question was asked. Reads top-to-bottom as "who can send
 * as what", which is the question this screen exists to answer.
 */
export function PermissionMatrix({
  rows,
  columns,
  isGranted,
  onToggle,
  pending,
  disabled = false,
  columnNoun,
  emptyMessage = "Nobody to show yet.",
}: PermissionMatrixProps) {
  if (rows.length === 0 || columns.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          Who can send as each {columnNoun}
        </caption>
        <thead>
          <tr className="border-b bg-muted/60">
            {/* Sticky so the name stays visible while scrolling columns. */}
            <th
              scope="col"
              className="sticky left-0 z-10 min-w-[13rem] bg-muted/60 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur"
            >
              Person
            </th>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className="px-2 py-2.5 text-center text-xs font-semibold text-muted-foreground"
              >
                <Hint label={column.hint ?? column.label} side="bottom">
                  <span className="mx-auto block max-w-[10rem] cursor-help truncate">
                    {column.label}
                  </span>
                </Hint>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-card px-3 py-2.5 text-left font-normal"
              >
                <div className="flex items-center gap-2.5">
                  <Avatar name={row.name} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{row.name}</div>
                    {row.secondary ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {row.secondary}
                      </div>
                    ) : null}
                  </div>
                </div>
              </th>

              {columns.map((column) => {
                const key = `${row.id}:${column.id}`;
                const busy = pending?.has(key) ?? false;
                const granted = isGranted(row.id, column.id);

                if (row.alwaysAllowed) {
                  return (
                    <td key={column.id} className="px-2 py-2.5 text-center">
                      <Hint
                        label={
                          row.alwaysAllowedReason ??
                          `${row.name} can always use this ${columnNoun}.`
                        }
                      >
                        <span className="inline-flex h-7 w-7 cursor-help items-center justify-center rounded-md text-muted-foreground">
                          <ShieldCheck className="h-4 w-4" />
                        </span>
                      </Hint>
                    </td>
                  );
                }

                return (
                  <td key={column.id} className="px-2 py-2.5 text-center">
                    <Hint
                      label={
                        granted
                          ? `Remove ${row.name}'s access to ${column.label}`
                          : `Let ${row.name} send as ${column.label}`
                      }
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={granted}
                        aria-label={`${row.name} can send as ${column.label}`}
                        disabled={disabled || busy}
                        onClick={() => onToggle(row.id, column.id, !granted)}
                        className={cn(
                          "inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50",
                          granted
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-card hover:border-primary/50 hover:bg-accent"
                        )}
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : granted ? (
                          <Check className="h-4 w-4" />
                        ) : null}
                      </button>
                    </Hint>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
