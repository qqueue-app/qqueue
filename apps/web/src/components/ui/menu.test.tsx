import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Trash2 } from "lucide-react";
import { renderWithProviders, screen, within } from "../../test/render.js";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "./menu.js";

/**
 * Force one side of the breakpoint. The shared setup stubs matchMedia to match
 * nothing, which is what makes the default branch the desktop one.
 */
function useViewport(mobile: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: mobile && query.includes("max-width: 639.98px"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

function renderMenu(onSelect: () => void) {
  renderWithProviders(
    <Menu label="Actions for Acme">
      <MenuTrigger>Open</MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={onSelect}>Rename</MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => {}}>
          <Trash2 />
          Delete
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

describe("Menu (§5)", () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  describe("desktop", () => {
    it("opens as a dropdown menu", async () => {
      restore = useViewport(false);
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderMenu(onSelect);

      await user.click(screen.getByRole("button", { name: "Open" }));
      const menu = within(await screen.findByRole("menu"));
      await user.click(menu.getByRole("menuitem", { name: "Rename" }));
      expect(onSelect).toHaveBeenCalled();
    });
  });

  describe("mobile", () => {
    it("opens as an action sheet, not a dropdown", async () => {
      restore = useViewport(true);
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderMenu(onSelect);

      await user.click(screen.getByRole("button", { name: "Open" }));

      // A dialog, because a bottom sheet is one — and deliberately not a menu.
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("names the sheet for screen readers, which have no visible heading to read", async () => {
      restore = useViewport(true);
      const user = userEvent.setup();
      renderMenu(vi.fn());

      await user.click(screen.getByRole("button", { name: "Open" }));
      expect(await screen.findByRole("dialog")).toHaveAccessibleName(
        "Actions for Acme"
      );
    });

    it("runs the action and closes itself", async () => {
      restore = useViewport(true);
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderMenu(onSelect);

      await user.click(screen.getByRole("button", { name: "Open" }));
      const sheet = within(await screen.findByRole("dialog"));
      await user.click(sheet.getByRole("button", { name: "Rename" }));

      expect(onSelect).toHaveBeenCalled();
      // A sheet that stays up after its action has been taken is a sheet the
      // user has to dismiss twice.
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
