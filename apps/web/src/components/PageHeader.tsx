import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, MoreHorizontal, type LucideIcon } from "lucide-react";
import { useIsMobile } from "../lib/use-media-query.js";
import { cn } from "../lib/utils.js";
import { Button } from "./ui/button.js";
import { IconButton } from "./ui/icon-button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";

export interface PageHeaderAction {
  /** A verb that names the outcome — "Create key", not "Submit". */
  label: string;
  onSelect?: () => void;
  /** Navigate instead of running a handler. Mutually exclusive with onSelect. */
  to?: string;
  icon?: LucideIcon;
  disabled?: boolean;
  /** At most one per header (§3): the main action. */
  primary?: boolean;
  destructive?: boolean;
}

interface PageHeaderProps {
  title: string;
  description: string;
  /**
   * Actions that a menu item can't express — a file picker, a control with its
   * own spinner or popover. Rendered beside the title on desktop and on a
   * second wrapped row on a phone, so nothing ever overflows the 48px row.
   *
   * Prefer `menuActions`: only those can collapse into the ⋯ menu.
   */
  actions?: ReactNode;
  /**
   * Declarative actions. Buttons on desktop; on a phone they become a trailing
   * ⋯ menu as soon as there is more than one of them.
   */
  menuActions?: PageHeaderAction[];
  /** Where the mobile back chevron goes. Also renders a desktop back link. */
  backTo?: string;
}

/**
 * The page header, in two shapes.
 *
 * Desktop (≥640px): a 20px title over a 13px description, actions to the right.
 * Deliberately not larger — a 32px headline reads as a landing page, and this
 * is a tool someone opens forty times a day.
 *
 * Mobile (<640px): one 48px row — back chevron, title, and a trailing ⋯ menu
 * (§5). The description is dropped rather than wrapped: on a 375px screen it
 * costs two lines of the thing you actually came to read, and the title has
 * already told you where you are.
 *
 * The two are separate render branches rather than one tree hidden both ways
 * with CSS, so an action exists once in the DOM and screen readers don't
 * announce every header twice.
 */
export function PageHeader({
  title,
  description,
  actions,
  menuActions,
  backTo,
}: PageHeaderProps) {
  const isMobile = useIsMobile();
  const items = menuActions ?? [];

  if (isMobile) {
    return (
      <header className="border-b border-border bg-surface">
        <div className="flex min-h-header-row items-center gap-1 px-2">
          {backTo ? (
            <IconButton label="Back" asChild hideTooltip>
              <Link to={backTo}>
                <ChevronLeft />
              </Link>
            </IconButton>
          ) : null}
          <h1
            className={cn(
              "min-w-0 flex-1 truncate text-section font-semibold text-text",
              backTo ? "px-0" : "px-2"
            )}
          >
            {title}
          </h1>
          <MobileActions items={items} />
        </div>

        {/*
          Escape-hatch actions get their own row here. Squeezing two or three
          real buttons into the 48px row is what produces a horizontally
          scrolling header at 375px — the one thing §5 rules out twice.
        */}
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
            {actions}
          </div>
        ) : null}
      </header>
    );
  }

  return (
    <div className="flex flex-col gap-4 border-b border-border px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {backTo ? (
          <Link
            to={backTo}
            className="mb-1 -ml-1 inline-flex items-center gap-1 rounded-control px-1 text-ui font-medium text-text-secondary transition-colors duration-fast ease-out hover:text-text"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Link>
        ) : null}
        <h1 className="text-title font-semibold text-text">{title}</h1>
        <p className="mt-1 max-w-[45rem] text-ui leading-6 text-text-secondary">
          {description}
        </p>
      </div>
      {actions || items.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
          {items.map((item) => (
            <DesktopAction key={item.label} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DesktopAction({ item }: { item: PageHeaderAction }) {
  const Icon = item.icon;
  const content = (
    <>
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {item.label}
    </>
  );
  const variant = item.primary
    ? "primary"
    : item.destructive
      ? "destructive"
      : "secondary";

  if (item.to) {
    return (
      <Button asChild variant={variant}>
        <Link to={item.to}>{content}</Link>
      </Button>
    );
  }

  return (
    <Button variant={variant} onClick={item.onSelect} disabled={item.disabled}>
      {content}
    </Button>
  );
}

/**
 * The trailing slot of the mobile header row.
 *
 * One action stays a button — burying a single action behind a menu costs a tap
 * and tells you nothing. Two or more collapse, which is the rule in §5.
 */
function MobileActions({ items }: { items: PageHeaderAction[] }) {
  if (items.length === 0) {
    return null;
  }

  if (items.length === 1) {
    const item = items[0];
    const Icon = item.icon;

    if (Icon) {
      return item.to ? (
        <IconButton label={item.label} asChild hideTooltip>
          <Link to={item.to}>
            <Icon />
          </Link>
        </IconButton>
      ) : (
        <IconButton
          label={item.label}
          onClick={item.onSelect}
          disabled={item.disabled}
          hideTooltip
        >
          <Icon />
        </IconButton>
      );
    }

    return item.to ? (
      <Button asChild variant="ghost" size="sm">
        <Link to={item.to}>{item.label}</Link>
      </Button>
    ) : (
      <Button
        variant="ghost"
        size="sm"
        onClick={item.onSelect}
        disabled={item.disabled}
      >
        {item.label}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="More actions" hideTooltip>
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {items.map((item) => {
          const Icon = item.icon;
          const content = (
            <>
              {Icon ? <Icon className="h-4 w-4" /> : null}
              {item.label}
            </>
          );

          if (item.to) {
            return (
              <DropdownMenuItem key={item.label} asChild>
                <Link to={item.to}>{content}</Link>
              </DropdownMenuItem>
            );
          }

          return (
            <DropdownMenuItem
              key={item.label}
              onSelect={item.onSelect}
              disabled={item.disabled}
              className={cn(
                item.destructive && "text-destructive focus:text-destructive"
              )}
            >
              {content}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
