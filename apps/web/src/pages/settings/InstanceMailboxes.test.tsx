import { renderWithProviders, screen, waitFor } from "../../test/render.js";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/api.js")>(
      "../../lib/api.js"
    );
  return {
    ApiError: actual.ApiError,
    api: { getMe: vi.fn(), listInstanceMailboxes: vi.fn() },
  };
});

import { api } from "../../lib/api.js";
import { InstanceMailboxes } from "./InstanceMailboxes.js";

const mailboxes = [
  {
    email: "hello@acme.test",
    domain: "acme.test",
    name: "Front desk",
    active: true,
    quotaBytes: 1024 * 1024 * 1024,
    usedBytes: 512 * 1024 * 1024,
    organizations: [{ id: "org_1", name: "Acme" }],
    connected: true,
  },
  {
    email: "archive@beta.test",
    domain: "beta.test",
    name: "Archive",
    active: false,
    quotaBytes: 0,
    usedBytes: 0,
    organizations: [],
    connected: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getMe).mockResolvedValue({
    user: { id: "admin_1", email: "admin@acme.test", isInstanceAdmin: true },
    organizations: [],
  });
  vi.mocked(api.listInstanceMailboxes).mockResolvedValue(mailboxes);
});

describe("InstanceMailboxes", () => {
  it("keeps the server-wide inventory behind the instance-admin gate", async () => {
    vi.mocked(api.getMe).mockResolvedValue({
      user: {
        id: "member_1",
        email: "member@acme.test",
        isInstanceAdmin: false,
      },
      organizations: [],
    });

    renderWithProviders(<InstanceMailboxes />);

    expect(
      await screen.findByText("Instance administrators only")
    ).toBeInTheDocument();
    expect(api.listInstanceMailboxes).not.toHaveBeenCalled();
  });

  it("shows server-only and unassigned mailboxes without hiding their state", async () => {
    renderWithProviders(<InstanceMailboxes />);

    expect(await screen.findByText("hello@acme.test")).toBeInTheDocument();
    expect(screen.getByText("Front desk")).toBeInTheDocument();
    expect(screen.getByText("512 MB of 1.0 GB")).toBeInTheDocument();
    expect(screen.getByText("archive@beta.test")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("Server only")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("filters mailboxes by domain", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InstanceMailboxes />);

    await screen.findByText("hello@acme.test");
    await user.click(
      screen.getByRole("combobox", { name: "Filter by domain" })
    );
    await user.click(screen.getByRole("option", { name: /beta\.test/ }));

    await waitFor(() =>
      expect(screen.queryByText("hello@acme.test")).not.toBeInTheDocument()
    );
    expect(screen.getByText("archive@beta.test")).toBeInTheDocument();
  });
});
