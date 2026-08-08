import * as React from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/lib/use-media-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./sheet.js";

/**
 * A menu that is a dropdown on a pointer and an action sheet on a phone (§5).
 *
 * The swap is a real component swap, not a restyle, because a dropdown cannot
 * be restyled into a sheet: Radix's popper writes `position`/`transform` inline
 * on a wrapper element it owns, so no class on the content can move it to the
 * bottom of the screen. Below 640px this therefore renders a bottom sheet
 * instead, and the two share this API so a call site describes its menu once.
 *
 * The other half of the reason is the target size. A dropdown item is 28px
 * tall, which is fine under a mouse and well under §5's 44px touch minimum; the
 * sheet's rows are full-width and touch-sized, which is what a menu opened by a
 * thumb has to be.
 *
 * Every part accepts the same props as its dropdown-menu counterpart, so
 * swapping an import is the whole migration.
 */

interface MenuContextValue {
  mobile: boolean;
  /** Sheet rows have to dismiss the sheet themselves; dropdown items don't. */
  close: () => void;
  /** Names the sheet for screen readers, since it has no visible title. */
  label: string;
}

const MenuContext = React.createContext<MenuContextValue>({
  mobile: false,
  close: () => {},
  label: "Menu",
});

export interface MenuProps {
  children: React.ReactNode;
  /**
   * What this menu is for — "More actions for Acme Inc". Used as the sheet's
   * accessible name on mobile, where there is no visible heading.
   */
  label?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function Menu({ children, label = "Menu", open, onOpenChange }: MenuProps) {
  const mobile = useIsMobile();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);

  const isOpen = open ?? uncontrolledOpen;
  const setOpen = React.useCallback(
    (next: boolean) => {
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange]
  );

  const context = React.useMemo(
    () => ({ mobile, close: () => setOpen(false), label }),
    [mobile, setOpen, label]
  );

  return (
    <MenuContext.Provider value={context}>
      {mobile ? (
        <Sheet open={isOpen} onOpenChange={setOpen}>
          {children}
        </Sheet>
      ) : (
        <DropdownMenu open={isOpen} onOpenChange={setOpen}>
          {children}
        </DropdownMenu>
      )}
    </MenuContext.Provider>
  );
}

/**
 * Both underlying triggers are the same Radix trigger with the same `asChild`
 * behaviour — one wired to a menu, one to a dialog — so this only has to pick
 * the matching half. The call site never has to know which it got.
 */
const MenuTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuTrigger>
>((props, ref) => {
  const { mobile } = React.useContext(MenuContext);
  return mobile ? (
    <SheetTrigger ref={ref} {...props} />
  ) : (
    <DropdownMenuTrigger ref={ref} {...props} />
  );
});
MenuTrigger.displayName = "MenuTrigger";

export type MenuContentProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuContent
>;

const MenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuContent>,
  MenuContentProps
>(({ className, children, onCloseAutoFocus, ...props }, ref) => {
  const { mobile, label } = React.useContext(MenuContext);

  if (mobile) {
    return (
      <SheetContent
        side="bottom"
        hideClose
        /*
          Forwarded, not dropped. Both primitives restore focus to the trigger
          on close, and a caller that suppresses that is doing it for a reason
          — the editor's variable menu puts the caret back in the document, and
          letting focus snap back to the toolbar button would undo that. A
          prop that silently works on one renderer and not the other is worse
          than no shared component at all.
        */
        onCloseAutoFocus={onCloseAutoFocus}
        // A list of actions has nothing to describe beyond its own rows, and
        // Radix wants that said explicitly rather than left missing.
        aria-describedby={undefined}
        className="gap-0 pb-card-safe"
      >
        {/* The sheet has no visible heading — the rows are the content — so
            Radix's required title is carried for screen readers only. */}
        <SheetTitle className="sr-only">{label}</SheetTitle>
        <div className="flex flex-col px-2 py-2">{children}</div>
      </SheetContent>
    );
  }

  return (
    <DropdownMenuContent
      ref={ref}
      className={className}
      onCloseAutoFocus={onCloseAutoFocus}
      {...props}
    >
      {children}
    </DropdownMenuContent>
  );
});
MenuContent.displayName = "MenuContent";

export type MenuItemProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuItem
>;

const MenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuItem>,
  MenuItemProps
>(({ className, children, onSelect, disabled, ...props }, ref) => {
  const { mobile, close } = React.useContext(MenuContext);

  if (mobile) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => {
          // Radix's onSelect carries an event a plain button doesn't have; the
          // handlers in this codebase never read it, and the cast keeps one
          // action definition working under both renderers.
          onSelect?.(event as unknown as Event);
          close();
        }}
        className={cn(
          "flex min-h-touch w-full items-center gap-3 rounded-control px-3 text-left text-body text-text",
          "transition-colors duration-fast ease-out active:bg-surface-sunken",
          "disabled:pointer-events-none disabled:opacity-50",
          "[&_svg]:size-icon-row [&_svg]:shrink-0 [&_svg]:text-text-tertiary",
          className
        )}
        {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </button>
    );
  }

  return (
    <DropdownMenuItem
      ref={ref}
      className={className}
      onSelect={onSelect}
      disabled={disabled}
      {...props}
    >
      {children}
    </DropdownMenuItem>
  );
});
MenuItem.displayName = "MenuItem";

const MenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuLabel>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuLabel>
>(({ className, ...props }, ref) => {
  const { mobile } = React.useContext(MenuContext);

  if (mobile) {
    return (
      <p
        className={cn(
          "px-3 pb-1 pt-3 text-eyebrow font-medium uppercase tracking-eyebrow text-text-tertiary",
          className
        )}
        {...(props as React.HTMLAttributes<HTMLParagraphElement>)}
      />
    );
  }

  return <DropdownMenuLabel ref={ref} className={className} {...props} />;
});
MenuLabel.displayName = "MenuLabel";

const MenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuSeparator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuSeparator>
>(({ className, ...props }, ref) => {
  const { mobile } = React.useContext(MenuContext);

  if (mobile) {
    return <div className={cn("my-2 h-px bg-border", className)} />;
  }

  return <DropdownMenuSeparator ref={ref} className={className} {...props} />;
});
MenuSeparator.displayName = "MenuSeparator";

export { Menu, MenuTrigger, MenuContent, MenuItem, MenuLabel, MenuSeparator };
