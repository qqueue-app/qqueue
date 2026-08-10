import { renderWithProviders, screen, waitFor } from "../../test/render.js";
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

const push = vi.hoisted(() => ({
  current: {
    status: "off" as string,
    reason: null as string | null,
    busy: false,
    enable: vi.fn(),
    disable: vi.fn(),
  },
}));
const notify = vi.hoisted(() => ({
  current: {
    level: "ALL" as string,
    isPending: false,
    saving: false,
    setLevel: vi.fn(),
  },
}));
vi.mock("../../lib/use-push-notifications.js", () => ({
  usePushNotifications: () => push.current,
  useInboxNotifyPreference: () => notify.current,
}));

// The install prompt is platform-detected and irrelevant to this page's own
// behaviour; it has its own path through `beforeinstallprompt`.
vi.mock("../../components/InstallAppCard.js", () => ({
  InstallAppCard: () => null,
}));

import { AccountSettings } from "./AccountSettings.js";

let originalLocation: Location;

beforeEach(() => {
  vi.clearAllMocks();
  sessionValue.current.signOut = vi.fn();
  push.current = {
    status: "off",
    reason: null,
    busy: false,
    enable: vi.fn(),
    disable: vi.fn(),
  };
  notify.current = {
    level: "ALL",
    isPending: false,
    saving: false,
    setLevel: vi.fn(),
  };
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

  it("turns device notifications on from the settings row", async () => {
    renderWithProviders(<AccountSettings />);

    await userEvent.click(
      screen.getByRole("switch", { name: "New mail alerts on this device" })
    );
    await waitFor(() => expect(push.current.enable).toHaveBeenCalled());
  });

  it("turns device notifications off again", async () => {
    push.current = { ...push.current, status: "on" };
    renderWithProviders(<AccountSettings />);

    const toggle = screen.getByRole("switch", {
      name: "New mail alerts on this device",
    });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(push.current.disable).toHaveBeenCalled());
  });

  it("explains itself instead of offering a dead toggle when push is blocked", () => {
    push.current = {
      ...push.current,
      status: "blocked",
      reason: "Notifications are blocked for this site.",
    };
    renderWithProviders(<AccountSettings />);

    expect(
      screen.queryByRole("switch", { name: "New mail alerts on this device" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("Notifications are blocked for this site.")
    ).toBeInTheDocument();
  });

  it("shows nothing at all while the push state is still loading", () => {
    push.current = { ...push.current, status: "loading" };
    renderWithProviders(<AccountSettings />);

    expect(
      screen.queryByText("New mail alerts on this device")
    ).not.toBeInTheDocument();
  });

  describe("which mail notifies you", () => {
    it("names the organization the preference applies to", () => {
      renderWithProviders(<AccountSettings />);
      expect(screen.getByText("Mail from Acme")).toBeInTheDocument();
    });

    it("still offers the choice when this browser has push blocked", () => {
      // The preference governs every device the person owns, so a permission
      // refused *here* is no reason to hide it.
      push.current = { ...push.current, status: "blocked" };
      renderWithProviders(<AccountSettings />);
      expect(screen.getByText("Mail from Acme")).toBeInTheDocument();
    });

    it("hides itself when the instance has no push at all", () => {
      push.current = { ...push.current, status: "unavailable" };
      renderWithProviders(<AccountSettings />);
      expect(screen.queryByText("Mail from Acme")).not.toBeInTheDocument();
    });

    it("saves a new level", async () => {
      renderWithProviders(<AccountSettings />);

      await userEvent.click(screen.getByRole("combobox"));
      await userEvent.click(
        await screen.findByRole("option", { name: "Nothing" })
      );

      await waitFor(() =>
        expect(notify.current.setLevel).toHaveBeenCalledWith("NONE")
      );
    });
  });
});
