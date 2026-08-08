import { renderWithProviders, screen, within } from "../test/render.js";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Plus, Trash2 } from "lucide-react";
import { PageHeader } from "./PageHeader.js";

/**
 * Force the mobile branch of `useIsMobile`. The shared setup stubs matchMedia
 * to match nothing, which is what makes every other page test render the
 * desktop header.
 */
function useMobileViewport() {
  const original = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("max-width: 639.98px"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

describe("PageHeader", () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  describe("desktop", () => {
    it("renders the title and description", () => {
      renderWithProviders(
        <PageHeader title="Contacts" description="Manage contacts" />
      );
      expect(
        screen.getByRole("heading", { name: "Contacts" })
      ).toBeInTheDocument();
      expect(screen.getByText("Manage contacts")).toBeInTheDocument();
    });

    it("renders actions when provided", () => {
      renderWithProviders(
        <PageHeader
          title="Contacts"
          description="x"
          actions={<button>Add</button>}
        />
      );
      expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    });

    it("omits the actions container when no actions provided", () => {
      const { container } = renderWithProviders(
        <PageHeader title="T" description="d" />
      );
      expect(container.querySelectorAll("button")).toHaveLength(0);
    });

    it("renders menu actions as buttons rather than hiding them in a menu", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderWithProviders(
        <PageHeader
          title="Templates"
          description="d"
          menuActions={[
            { label: "New template", icon: Plus, onSelect, primary: true },
            { label: "Delete", icon: Trash2, destructive: true }
          ]}
        />
      );
      await user.click(screen.getByRole("button", { name: "New template" }));
      expect(onSelect).toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Delete" })
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "More actions" })
      ).not.toBeInTheDocument();
    });

    it("renders a back link when backTo is set", () => {
      renderWithProviders(
        <PageHeader title="Edit" description="d" backTo="/templates" />
      );
      expect(screen.getByRole("link", { name: /Back/ })).toHaveAttribute(
        "href",
        "/templates"
      );
    });

    it("renders a breadcrumb trail naming the parent and the page (§4)", () => {
      renderWithProviders(
        <PageHeader
          title="Team"
          description="d"
          breadcrumb={{ label: "Settings", to: "/settings" }}
        />
      );
      const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
      expect(within(trail).getByRole("link", { name: "Settings" })).toHaveAttribute(
        "href",
        "/settings"
      );
      expect(trail).toHaveTextContent(/Settings\s*\/\s*Team/);
      // The trail replaces the generic back link; two ways up is one too many.
      expect(screen.queryByRole("link", { name: /^Back/ })).not.toBeInTheDocument();
    });
  });

  /*
    Class names rather than layout, because jsdom has none — but the container
    is a class, so this is exactly how the alignment would break.
  */
  describe("page measure", () => {
    it("keeps the rule full-bleed and the text contained when asked", () => {
      const { container } = renderWithProviders(
        <PageHeader title="Compose" description="d" width="container" />
      );
      const rule = container.firstElementChild!;
      const inner = rule.firstElementChild!;

      // The rule divides the page, so it must not be constrained...
      expect(rule).toHaveClass("border-b");
      expect(rule.className).not.toMatch(/(^|\s)container(\s|$)/);
      // ...while the text takes the page's measure, lining up with the content
      // below it. That mismatch is the whole reason this split exists.
      expect(inner).toHaveClass("container");
      expect(inner.className).not.toMatch(/px-6/);
    });

    it("defaults to the unconverted full-width header", () => {
      const { container } = renderWithProviders(
        <PageHeader title="Contacts" description="d" />
      );
      const inner = container.firstElementChild!.firstElementChild!;

      // The gate that keeps every page this component renders byte-identical
      // until the container rollout reaches it. A centred header over
      // left-aligned content is worse than either alignment on its own.
      expect(inner).toHaveClass("px-6");
      expect(inner.className).not.toMatch(/(^|\s)container(\s|$)/);
    });
  });

  describe("mobile (§5)", () => {
    it("drops the description so the header stays one row", () => {
      restore = useMobileViewport();
      renderWithProviders(
        <PageHeader title="Contacts" description="Manage contacts" />
      );
      expect(
        screen.getByRole("heading", { name: "Contacts" })
      ).toBeInTheDocument();
      expect(screen.queryByText("Manage contacts")).not.toBeInTheDocument();
    });

    it("renders a back chevron pointing at backTo", () => {
      restore = useMobileViewport();
      renderWithProviders(
        <PageHeader title="Edit" description="d" backTo="/templates" />
      );
      expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
        "href",
        "/templates"
      );
    });

    it("collapses a breadcrumb to the back chevron", () => {
      restore = useMobileViewport();
      renderWithProviders(
        <PageHeader
          title="Team"
          description="d"
          breadcrumb={{ label: "Settings", to: "/settings" }}
        />
      );
      // A trail whose first half is the button beside it costs a row on the
      // screen with the fewest to spare (§5).
      expect(
        screen.queryByRole("navigation", { name: "Breadcrumb" })
      ).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
        "href",
        "/settings"
      );
    });

    it("collapses more than one action into a ⋯ menu", async () => {
      restore = useMobileViewport();
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderWithProviders(
        <PageHeader
          title="Templates"
          description="d"
          menuActions={[
            { label: "New template", icon: Plus, onSelect },
            { label: "Delete", icon: Trash2, destructive: true }
          ]}
        />
      );

      // Neither action is on the row itself…
      expect(
        screen.queryByRole("button", { name: "New template" })
      ).not.toBeInTheDocument();

      /*
        …they are behind the overflow menu, which on a phone is an action
        sheet rather than a dropdown (§5) — so the menu is a `dialog` and its
        entries are ordinary buttons, sized to the 44px touch minimum a 28px
        dropdown item could never meet.
      */
      await user.click(screen.getByRole("button", { name: "More actions" }));
      const sheet = within(await screen.findByRole("dialog"));
      await user.click(sheet.getByRole("button", { name: "New template" }));
      expect(onSelect).toHaveBeenCalled();
    });

    it("leaves a single action on the row — a menu of one costs a tap", () => {
      restore = useMobileViewport();
      renderWithProviders(
        <PageHeader
          title="Templates"
          description="d"
          menuActions={[{ label: "New template", icon: Plus }]}
        />
      );
      expect(
        screen.getByRole("button", { name: "New template" })
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "More actions" })
      ).not.toBeInTheDocument();
    });

    it("keeps escape-hatch actions reachable instead of hiding them", () => {
      restore = useMobileViewport();
      renderWithProviders(
        <PageHeader
          title="Contacts"
          description="d"
          actions={<button>Import</button>}
        />
      );
      expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
    });
  });
});
