import * as React from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button.js";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "./menu.js";

export interface RowAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  /** Renders in the destructive colour and is separated from the rest. */
  destructive?: boolean;
  /** Show as its own always-visible icon button rather than a menu entry. */
  primary?: boolean;
  hidden?: boolean;
}

export interface RowActionsProps {
  actions: RowAction[];
  /** Names the row so the overflow menu's label is specific, not just "More". */
  rowLabel: string;
  className?: string;
}

/**
 * The trailing actions cell of a data-grid row. Actions marked `primary` sit
 * inline as tooltipped icon buttons; the rest collapse into an overflow menu so
 * a row never turns into a wall of icons.
 */
export function RowActions({ actions, rowLabel, className }: RowActionsProps) {
  const visible = actions.filter((action) => !action.hidden);
  const inline = visible.filter((action) => action.primary);
  const overflow = visible.filter((action) => !action.primary);
  const destructive = overflow.filter((action) => action.destructive);
  const regular = overflow.filter((action) => !action.destructive);

  if (visible.length === 0) return null;

  return (
    <div
      className={cn("flex items-center justify-end gap-1", className)}
      // Rows are often clickable; actions must not also trigger the row.
      onClick={(event) => event.stopPropagation()}
    >
      {inline.map((action) => {
        const Icon = action.icon;
        return (
          <IconButton
            key={action.label}
            label={action.label}
            size="sm"
            variant={action.destructive ? "destructive" : "ghost"}
            disabled={action.disabled}
            onClick={action.onSelect}
          >
            <Icon />
          </IconButton>
        );
      })}

      {overflow.length > 0 ? (
        <Menu label={`Actions for ${rowLabel}`}>
          <MenuTrigger asChild>
            <IconButton label={`More actions for ${rowLabel}`} size="sm">
              <MoreHorizontal />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end">
            {regular.map((action) => {
              const Icon = action.icon;
              return (
                <MenuItem
                  key={action.label}
                  disabled={action.disabled}
                  onSelect={action.onSelect}
                >
                  <Icon />
                  {action.label}
                </MenuItem>
              );
            })}
            {destructive.length > 0 && regular.length > 0 ? (
              <MenuSeparator />
            ) : null}
            {destructive.map((action) => {
              const Icon = action.icon;
              return (
                <MenuItem
                  key={action.label}
                  disabled={action.disabled}
                  onSelect={action.onSelect}
                  className="text-err focus:text-err [&_svg]:text-err"
                >
                  <Icon />
                  {action.label}
                </MenuItem>
              );
            })}
          </MenuContent>
        </Menu>
      ) : null}
    </div>
  );
}
