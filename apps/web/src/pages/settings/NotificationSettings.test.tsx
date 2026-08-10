import { renderWithProviders, screen, waitFor } from "../../test/render.js";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionValue = vi.hoisted(() => ({
  current: {
    user: { id: "u1", email: "me@x.com" },
    currentOrganizationId: "org_1" as string | null,
    currentOrganization: { id: "org_1", name: "Acme", role: "MEMBER" },
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

// The install prompt is platform-detected and has its own path through
// `beforeinstallprompt`; it says nothing about this page's behaviour.
vi.mock("../../components/InstallAppCard.js", () => ({
  InstallAppCard: () => null,
}));

const apiMock = vi.hoisted(() => ({
  inboxNotifySettings: vi.fn(),
  updateInboxNotifyRule: vi.fn(),
}));
vi.mock("../../lib/api.js", () => ({ api: apiMock, apiBaseUrl: "" }));

import { NotificationSettings } from "./NotificationSettings.js";

function settings(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "org_1",
    notifyLevel: "ALL",
    domains: [
      {
        domain: "acme.test",
        state: "ALL",
        mailboxes: [
          {
            inboxAccountId: "inbox_1",
            email: "support@acme.test",
            name: "Support",
            enabled: true,
            explicit: false,
          },
          {
            inboxAccountId: "inbox_2",
            email: "sales@acme.test",
            name: "Sales",
            enabled: true,
            explicit: false,
          },
        ],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionValue.current.currentOrganizationId = "org_1";
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
  apiMock.inboxNotifySettings.mockResolvedValue(settings());
  apiMock.updateInboxNotifyRule.mockResolvedValue(settings());
});

describe("NotificationSettings", () => {
  describe("this device", () => {
    it("turns device notifications on from the settings row", async () => {
      renderWithProviders(<NotificationSettings />);

      await userEvent.click(
        screen.getByRole("switch", { name: "New mail alerts on this device" })
      );
      await waitFor(() => expect(push.current.enable).toHaveBeenCalled());
    });

    it("turns device notifications off again", async () => {
      push.current = { ...push.current, status: "on" };
      renderWithProviders(<NotificationSettings />);

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
      renderWithProviders(<NotificationSettings />);

      expect(
        screen.queryByRole("switch", { name: "New mail alerts on this device" })
      ).not.toBeInTheDocument();
      expect(screen.getByText("Unavailable")).toBeInTheDocument();
    });

    it("shows nothing at all while the push state is still loading", () => {
      push.current = { ...push.current, status: "loading" };
      renderWithProviders(<NotificationSettings />);

      expect(
        screen.queryByText("New mail alerts on this device")
      ).not.toBeInTheDocument();
    });

    it("hides the mailbox list when the instance has no push at all", async () => {
      push.current = { ...push.current, status: "unavailable" };
      renderWithProviders(<NotificationSettings />);

      expect(await screen.findByText(/This device/)).toBeInTheDocument();
      expect(screen.queryByText("acme.test")).not.toBeInTheDocument();
    });
  });

  describe("mailboxes", () => {
    it("lists domains first, collapsed, with what each is doing", async () => {
      renderWithProviders(<NotificationSettings />);

      expect(await screen.findByText("acme.test")).toBeInTheDocument();
      expect(screen.getByText("All 2 notifying")).toBeInTheDocument();
      // Collapsed by default: the domain answer is the one most people want.
      expect(screen.queryByText("support@acme.test")).not.toBeInTheDocument();
    });

    it("reveals the mailboxes on a domain when it is expanded", async () => {
      renderWithProviders(<NotificationSettings />);

      await userEvent.click(await screen.findByRole("button", { name: /acme\.test/ }));

      expect(await screen.findByText("support@acme.test")).toBeInTheDocument();
      expect(screen.getByText("sales@acme.test")).toBeInTheDocument();
    });

    it("mutes a whole domain from the collapsed row", async () => {
      renderWithProviders(<NotificationSettings />);

      await userEvent.click(
        await screen.findByRole("checkbox", {
          name: "Mute every mailbox you have on acme.test",
        })
      );

      await waitFor(() =>
        expect(apiMock.updateInboxNotifyRule).toHaveBeenCalled()
      );
      expect(apiMock.updateInboxNotifyRule.mock.calls[0][0]).toEqual({
        organizationId: "org_1",
        enabled: false,
        target: { scope: "DOMAIN", domain: "acme.test" },
      });
    });

    it("turns a muted domain back on", async () => {
      apiMock.inboxNotifySettings.mockResolvedValue(
        settings({
          domains: [
            {
              domain: "acme.test",
              state: "NONE",
              mailboxes: [
                {
                  inboxAccountId: "inbox_1",
                  email: "support@acme.test",
                  name: "Support",
                  enabled: false,
                  explicit: false,
                },
              ],
            },
          ],
        })
      );
      renderWithProviders(<NotificationSettings />);

      expect(await screen.findByText("Muted")).toBeInTheDocument();
      await userEvent.click(
        screen.getByRole("checkbox", {
          name: "Turn on notifications for every mailbox you have on acme.test",
        })
      );

      await waitFor(() =>
        expect(apiMock.updateInboxNotifyRule).toHaveBeenCalled()
      );
      expect(apiMock.updateInboxNotifyRule.mock.calls[0][0]).toMatchObject({
        enabled: true,
      });
    });

    it("reports a partly-muted domain honestly, and mixed to a screen reader", async () => {
      apiMock.inboxNotifySettings.mockResolvedValue(
        settings({
          domains: [
            {
              domain: "acme.test",
              state: "SOME",
              mailboxes: [
                {
                  inboxAccountId: "inbox_1",
                  email: "support@acme.test",
                  name: "Support",
                  enabled: true,
                  explicit: false,
                },
                {
                  inboxAccountId: "inbox_2",
                  email: "sales@acme.test",
                  name: "Sales",
                  enabled: false,
                  explicit: true,
                },
              ],
            },
          ],
        })
      );
      renderWithProviders(<NotificationSettings />);

      // A domain with one mailbox muted is neither on nor off, and drawing it
      // as "off" is the small lie that stops people trusting the page.
      expect(await screen.findByText("1 of 2 notifying")).toBeInTheDocument();
      expect(
        screen.getByRole("checkbox", {
          name: "Turn on notifications for every mailbox you have on acme.test",
        })
      ).toHaveAttribute("aria-checked", "mixed");
    });

    it("mutes one mailbox without touching its neighbours", async () => {
      renderWithProviders(<NotificationSettings />);

      await userEvent.click(await screen.findByRole("button", { name: /acme\.test/ }));
      await userEvent.click(
        await screen.findByRole("checkbox", { name: "Mute support@acme.test" })
      );

      await waitFor(() =>
        expect(apiMock.updateInboxNotifyRule).toHaveBeenCalled()
      );
      expect(apiMock.updateInboxNotifyRule.mock.calls[0][0]).toEqual({
        organizationId: "org_1",
        enabled: false,
        target: { scope: "MAILBOX", inboxAccountId: "inbox_1" },
      });
    });

    it("says so plainly when the person holds no mailboxes yet", async () => {
      apiMock.inboxNotifySettings.mockResolvedValue(settings({ domains: [] }));
      renderWithProviders(<NotificationSettings />);

      expect(
        await screen.findByText(/don't have any mailboxes yet/)
      ).toBeInTheDocument();
    });
  });

  describe("which mail", () => {
    it("saves a new level", async () => {
      renderWithProviders(<NotificationSettings />);

      await userEvent.click(await screen.findByRole("combobox"));
      await userEvent.click(
        await screen.findByRole("option", { name: "Nothing" })
      );

      await waitFor(() =>
        expect(notify.current.setLevel).toHaveBeenCalledWith("NONE")
      );
    });

    it("still offers the choice when this browser has push blocked", async () => {
      // It governs every device the person owns, so a permission refused
      // *here* is no reason to hide it.
      push.current = { ...push.current, status: "blocked" };
      renderWithProviders(<NotificationSettings />);

      expect(await screen.findByRole("combobox")).toBeInTheDocument();
    });
  });
});
