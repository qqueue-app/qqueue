import { renderWithProviders, screen } from "../../test/render.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Force the mobile branch of `useIsMobile`. The shared setup stubs matchMedia
 * to match nothing, which is what makes every other page test render desktop.
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
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const sessionValue = vi.hoisted(() => ({
  current: {
    user: { id: "u1", email: "me@x.com" },
    organizations: [{ id: "o1", name: "Acme", role: "OWNER" }],
    currentOrganizationId: "o1",
    currentOrganization: { id: "o1", name: "Acme", role: "OWNER" },
    setCurrentOrganizationId: vi.fn(),
    addOrganization: vi.fn(),
    signOut: vi.fn(),
  },
}));
vi.mock("../../lib/session-context.js", () => ({
  useSession: () => sessionValue.current,
}));

vi.mock("../../lib/use-instance-admin.js", () => ({
  useInstanceAdmin: () => ({
    isInstanceAdmin: true,
    settings: { allowPublicRegistration: true, setupCompletedAt: null },
    isPending: false,
  }),
}));

vi.mock("../../lib/use-push-notifications.js", () => ({
  usePushNotifications: () => ({
    status: "off",
    reason: null,
    busy: false,
    enable: vi.fn(),
    disable: vi.fn(),
  }),
  useInboxNotifyPreference: () => ({
    level: "ALL",
    isPending: false,
    saving: false,
    setLevel: vi.fn(),
  }),
}));

vi.mock("../../components/InstallAppCard.js", () => ({
  InstallAppCard: () => null,
}));

vi.mock("../../lib/api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/api.js")>("../../lib/api.js");
  return {
    ApiError: actual.ApiError,
    apiBaseUrl: actual.apiBaseUrl,
    outboundWebhookEvents: actual.outboundWebhookEvents,
    api: {
      createOrganization: vi.fn(),
      updateOrganization: vi.fn(),
      listOrganizationMembers: vi.fn().mockResolvedValue([
        {
          id: "m1",
          organizationId: "o1",
          userId: "u1",
          role: "OWNER",
          createdAt: "2026-01-01",
          user: { id: "u1", email: "me@x.com", name: "Me" },
        },
      ]),
      listInvites: vi.fn().mockResolvedValue([]),
      createInvite: vi.fn(),
      revokeInvite: vi.fn(),
      updateMemberRole: vi.fn(),
      removeMember: vi.fn(),
      listApiKeys: vi.fn().mockResolvedValue([
        {
          id: "key_1",
          organizationId: "o1",
          name: "Production",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastUsedAt: null,
          revokedAt: null,
        },
      ]),
      createApiKey: vi.fn(),
      revokeApiKey: vi.fn(),
      listWebhookEndpoints: vi.fn().mockResolvedValue([]),
      createWebhookEndpoint: vi.fn(),
      deleteWebhookEndpoint: vi.fn(),
      listWebhookDeliveries: vi.fn().mockResolvedValue([]),
      retryWebhookDelivery: vi.fn(),
      getInstanceSettings: vi.fn(),
      updateInstanceSettings: vi.fn(),
      instanceEnvStatus: vi.fn().mockResolvedValue({
        database: { ok: true },
        redis: { ok: true, host: "localhost", port: 6379 },
        storage: { endpoint: "aws-default", bucket: "qqueue-attachments" },
        secrets: { webhookSecretConfigured: true },
        urls: {
          appUrl: "http://localhost:4000",
          publicAppUrl: "http://localhost:4000",
          webOrigin: null,
        },
        tunables: {
          softBounceThreshold: 5,
          softBounceWindowDays: 7,
          defaultDomainMaxPerMinute: 60,
          attachmentMaxBytes: 10_485_760,
        },
      }),
    },
  };
});

import { AccountSettings } from "./AccountSettings.js";
import { ApiSettings } from "./ApiSettings.js";
import { InstanceSettings } from "./InstanceSettings.js";
import { OrganizationSettings } from "./OrganizationSettings.js";
import { SettingsHub } from "./SettingsHub.js";
import { TeamSettings } from "./TeamSettings.js";

const subpages = [
  ["Organization", <OrganizationSettings key="org" />],
  ["Team", <TeamSettings key="team" />],
  ["API", <ApiSettings key="api" />],
  ["Instance", <InstanceSettings key="instance" />],
  ["Account", <AccountSettings key="account" />],
] as const;

let restore: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  restore = useMobileViewport();
});

afterEach(() => {
  restore?.();
  restore = undefined;
});

/**
 * The <640px band, checked structurally.
 *
 * jsdom has no layout engine, so these assert the things that *decide* the
 * mobile layout rather than measuring the result: which branch the header
 * rendered, that no data table exists to overflow, that fields carry the
 * mobile-first width and font-size classes, and that every row is at least a
 * touch target tall. §7's checklist, in the only form a unit test can hold it.
 */
describe("settings pages at <640px (§5)", () => {
  it.each(subpages)("%s: header collapses to one row with a way back", (_, page) => {
    renderWithProviders(page);

    // The mobile branch: a back chevron instead of the desktop breadcrumb, and
    // no description eating two lines of a 375px screen.
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
      "href",
      "/settings"
    );
    expect(
      screen.queryByRole("navigation", { name: "Breadcrumb" })
    ).not.toBeInTheDocument();
  });

  it.each([["Settings hub", <SettingsHub key="hub" />], ...subpages])(
    "%s: renders no data table to scroll sideways",
    (_, page) => {
      const { container } = renderWithProviders(page);
      expect(container.querySelector("table")).toBeNull();
    }
  );

  it.each([["Settings hub", <SettingsHub key="hub" />], ...subpages])(
    "%s: lays the content out in the padded page column",
    (_, page) => {
      const { container } = renderWithProviders(page);
      // Settings used to cap itself at 640px, half the width of every other
      // page. It wears the app's one page measure now — and, either way, the
      // padding has to live on the column so a full-width field means "the
      // column", not "the viewport". Tailwind's `container` supplies it: 16px
      // on a phone, 24px from the tablet breakpoint up.
      const column = container.querySelector(".container");
      expect(column).not.toBeNull();
      expect(column!.firstElementChild).toHaveClass("mx-auto", "max-w-page");
    }
  );

  it.each([
    ["Organization", <OrganizationSettings key="org" />],
    ["API", <ApiSettings key="api" />],
  ])("%s: fields go full width below 480px and stay 16px", (_, page) => {
    const { container } = renderWithProviders(page);
    const inputs = Array.from(container.querySelectorAll("input"));
    expect(inputs.length).toBeGreaterThan(0);

    for (const input of inputs) {
      // The mobile inversion: content-sized widths only kick in at `xs`.
      expect(input.className).toMatch(/\bw-full\b/);
      // 16px, or iOS Safari zooms the viewport the moment the field is focused.
      expect(input.className).toContain("text-base");
      expect(input.className).toContain("sm:text-body");
    }
  });

  it.each([["Settings hub", <SettingsHub key="hub" />], ...subpages])(
    "%s: every tappable row and control clears 44px",
    (_, page) => {
      const { container } = renderWithProviders(page);

      // Link rows and list rows carry the touch minimum outright.
      for (const row of Array.from(container.querySelectorAll("li > a, li"))) {
        const classes = (row as HTMLElement).className;
        if (typeof classes !== "string" || !classes.includes("border-b")) continue;
        expect(classes).toContain("min-h-touch");
      }

      /*
        Two legitimate ways to clear 44px, and every button has to use one:
        grow an invisible hit area around a 36px control (buttons, toggles), or
        be drawn at 44px on a phone and 36px above it (fields and select
        triggers, which are `::after`-less or need the room anyway).
      */
      for (const button of Array.from(container.querySelectorAll("button"))) {
        expect(
          button.className,
          `${button.getAttribute("aria-label") ?? button.textContent} is under 44px on a phone`
        ).toMatch(/(?:^|\s)(?:after:)?(?:min-)?h-touch(?:\s|$)/);
      }
    }
  );
});
