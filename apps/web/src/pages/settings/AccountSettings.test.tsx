import { renderWithProviders, screen } from "../../test/render.js";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionValue = vi.hoisted(() => ({
  current: {
    user: { id: "u1", email: "me@x.com" },
    currentOrganization: { id: "org_1", name: "Acme" },
    signOut: vi.fn(),
  },
}));
vi.mock("../../lib/session-context.js", () => ({
  useSession: () => sessionValue.current,
}));

import { AccountSettings } from "./AccountSettings.js";

let originalLocation: Location;

beforeEach(() => {
  vi.clearAllMocks();
  sessionValue.current.signOut = vi.fn();
  originalLocation = window.location;
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("AccountSettings", () => {
  it("shows who is signed in", () => {
    renderWithProviders(<AccountSettings />);
    expect(screen.getByText("me@x.com")).toBeInTheDocument();
    expect(screen.getByText("API base URL")).toBeInTheDocument();
  });

  it("signs out and redirects", async () => {
    const hrefSetter = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        origin: "http://localhost",
        set href(value: string) {
          hrefSetter(value);
        },
      },
    });

    renderWithProviders(<AccountSettings />);
    await userEvent.click(screen.getByRole("button", { name: /Sign out/i }));

    expect(sessionValue.current.signOut).toHaveBeenCalled();
    expect(hrefSetter).toHaveBeenCalledWith("/login");
  });

  it("points at the notifications page rather than holding the controls", () => {
    // Alerts outgrew a single select once members hold individual mailboxes,
    // so they became their own destination. This page keeps the signpost,
    // because it is still where somebody looks for them first.
    renderWithProviders(<AccountSettings />);

    const link = screen.getByRole("link", { name: /Notifications/ });
    expect(link).toHaveAttribute("href", "/settings/notifications");
    expect(
      screen.queryByRole("switch", { name: "New mail alerts on this device" })
    ).not.toBeInTheDocument();
  });
});
