import { renderWithProviders, screen } from "../../test/render.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionRef = vi.hoisted(() => ({
  current: {} as { currentOrganization?: { role: string } },
}));
vi.mock("../../lib/session-context.js", () => ({
  useSession: () => sessionRef.current,
}));

const instanceAdmin = vi.hoisted(() => ({
  current: { isInstanceAdmin: false as boolean | undefined },
}));
vi.mock("../../lib/use-instance-admin.js", () => ({
  useInstanceAdmin: () => instanceAdmin.current,
}));

import { SettingsHub } from "./SettingsHub.js";

function row(name: string) {
  return screen.queryByRole("link", { name: new RegExp(`^${name}`) });
}

beforeEach(() => {
  sessionRef.current = { currentOrganization: { role: "OWNER" } };
  instanceAdmin.current = { isInstanceAdmin: false };
});

describe("SettingsHub", () => {
  it("lists the org-scoped destinations for an owner", () => {
    renderWithProviders(<SettingsHub />);

    expect(row("Organization")).toHaveAttribute(
      "href",
      "/settings/organization"
    );
    expect(row("Team")).toHaveAttribute("href", "/settings/team");
    expect(row("Sending accounts")).toHaveAttribute(
      "href",
      "/settings/sending"
    );
    expect(row("Mailboxes")).toHaveAttribute("href", "/settings/mailboxes");
    expect(row("Suppressions")).toHaveAttribute(
      "href",
      "/settings/suppressions"
    );
    expect(row("API")).toHaveAttribute("href", "/settings/api");
  });

  it("keeps account settings in their own group, out of the organization's", () => {
    renderWithProviders(<SettingsHub />);

    expect(row("Account")).toHaveAttribute("href", "/settings/account");
    expect(screen.getByRole("heading", { name: "You" })).toBeInTheDocument();
  });

  it("hides admin-only destinations from a member", () => {
    sessionRef.current = { currentOrganization: { role: "MEMBER" } };
    renderWithProviders(<SettingsHub />);

    expect(row("Team")).not.toBeInTheDocument();
    expect(row("Mailboxes")).not.toBeInTheDocument();
    expect(row("Background jobs")).not.toBeInTheDocument();
    // Everything they can actually use is still there.
    expect(row("Sending accounts")).toBeInTheDocument();
    expect(row("Suppressions")).toBeInTheDocument();
    expect(row("Account")).toBeInTheDocument();
  });

  it("hides Instance unless the probe says the user administers the server", () => {
    renderWithProviders(<SettingsHub />);
    expect(row("Instance")).not.toBeInTheDocument();
  });

  it("shows Instance to an instance admin", () => {
    instanceAdmin.current = { isInstanceAdmin: true };
    renderWithProviders(<SettingsHub />);
    expect(row("Instance")).toHaveAttribute("href", "/settings/instance");
  });

  it("keeps Instance hidden while the probe is still in flight", () => {
    instanceAdmin.current = { isInstanceAdmin: undefined };
    renderWithProviders(<SettingsHub />);
    expect(row("Instance")).not.toBeInTheDocument();
  });
});
