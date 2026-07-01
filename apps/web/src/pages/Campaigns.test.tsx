import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const session = vi.hoisted(() => ({ current: { currentOrganizationId: "org_1" } }));
vi.mock("../lib/session-context.js", () => ({ useSession: () => session.current }));

vi.mock("../lib/api.js", () => ({
  api: {
    listCampaigns: vi.fn(),
    listTemplates: vi.fn(),
    listContactLists: vi.fn(),
    createCampaign: vi.fn(),
    updateCampaign: vi.fn(),
    duplicateCampaign: vi.fn(),
    deleteCampaign: vi.fn(),
    sendCampaignNow: vi.fn(),
    scheduleCampaign: vi.fn(),
    setCampaignRecurrence: vi.fn(),
    pauseCampaign: vi.fn(),
    resumeCampaign: vi.fn()
  }
}));

import { Campaigns } from "./Campaigns.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const templates = [
  { id: "t1", organizationId: "org_1", name: "Welcome", subject: "Hi", html: "" }
];
const lists = [
  { id: "l1", organizationId: "org_1", name: "VIPs", _count: { contacts: 5 } }
];

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "cmp1",
    organizationId: "org_1",
    name: "Spring",
    status: "DRAFT",
    template: { id: "t1", name: "Welcome", subject: "Hi there" },
    contactList: { id: "l1", name: "VIPs", _count: { members: 5 } },
    templateId: "t1",
    contactListId: "l1",
    _count: { emailJobs: 0 },
    ...overrides
  };
}

function setup(campaigns: Record<string, unknown>[]) {
  mockedApi.listCampaigns.mockResolvedValue(campaigns);
  mockedApi.listTemplates.mockResolvedValue(templates);
  mockedApi.listContactLists.mockResolvedValue(lists);
}

function renderCampaigns() {
  return render(
    <MemoryRouter>
      <Campaigns />
    </MemoryRouter>
  );
}

describe("Campaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = { currentOrganizationId: "org_1" };
  });

  it("shows the empty state", async () => {
    setup([]);
    renderCampaigns();
    expect(await screen.findByText("No campaigns yet")).toBeInTheDocument();
  });

  it("renders campaigns and status filters", async () => {
    setup([campaign(), campaign({ id: "cmp2", name: "Summer", status: "SENT" })]);
    renderCampaigns();
    expect(await screen.findByText("Spring")).toBeInTheDocument();
    expect(screen.getByText("Summer")).toBeInTheDocument();
    expect(screen.getAllByText("Hi there").length).toBeGreaterThan(0);
    expect(screen.getAllByText("VIPs").length).toBeGreaterThan(0);
  });

  it("filters by status", async () => {
    const user = userEvent.setup();
    setup([campaign(), campaign({ id: "cmp2", name: "Summer", status: "SENT" })]);
    renderCampaigns();
    await screen.findByText("Spring");
    await user.click(screen.getByRole("button", { name: /Sent/ }));
    expect(screen.getByText("Summer")).toBeInTheDocument();
    expect(screen.queryByText("Spring")).not.toBeInTheDocument();
  });

  it("shows a per-filter empty row", async () => {
    const user = userEvent.setup();
    setup([campaign()]); // only a DRAFT
    renderCampaigns();
    await screen.findByText("Spring");
    await user.click(screen.getByRole("button", { name: /Paused/ }));
    expect(screen.getByText("No paused campaigns.")).toBeInTheDocument();
  });

  it("creates a campaign", async () => {
    const user = userEvent.setup();
    setup([]);
    mockedApi.createCampaign.mockResolvedValue({ id: "cmpx" });
    renderCampaigns();
    await screen.findByText("No campaigns yet");
    await user.click(screen.getByRole("button", { name: /New campaign/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Launch");
    // pick template + list via the comboboxes
    const selects = within(dialog).getAllByRole("combobox");
    await user.click(selects[0]);
    await user.click(await screen.findByRole("option", { name: "Welcome" }));
    await user.click(selects[1]);
    await user.click(await screen.findByRole("option", { name: "VIPs" }));
    await user.click(
      within(dialog).getByRole("button", { name: "Create draft" })
    );
    await waitFor(() => expect(mockedApi.createCampaign).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Campaign draft created.");
  });

  it("sends a campaign now", async () => {
    const user = userEvent.setup();
    setup([campaign()]);
    mockedApi.sendCampaignNow.mockResolvedValue({});
    renderCampaigns();
    await screen.findByText("Spring");
    await user.click(screen.getByLabelText("Send campaign now"));
    await waitFor(() =>
      expect(mockedApi.sendCampaignNow).toHaveBeenCalledWith("cmp1")
    );
  });

  it("schedules a campaign for a fixed time", async () => {
    const user = userEvent.setup();
    setup([campaign()]);
    mockedApi.scheduleCampaign.mockResolvedValue({});
    renderCampaigns();
    await screen.findByText("Spring");
    await user.click(screen.getByLabelText("Schedule campaign"));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Send at"),
      "2030-01-01T09:00"
    );
    await user.click(within(dialog).getByRole("button", { name: "Schedule" }));
    await waitFor(() =>
      expect(mockedApi.scheduleCampaign).toHaveBeenCalledWith(
        "cmp1",
        expect.any(String)
      )
    );
  });

  it("sets a recurring schedule", async () => {
    const user = userEvent.setup();
    setup([campaign()]);
    mockedApi.setCampaignRecurrence.mockResolvedValue({});
    renderCampaigns();
    await screen.findByText("Spring");
    await user.click(screen.getByLabelText("Schedule campaign"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Repeat on a schedule"));
    await user.click(
      within(dialog).getByRole("button", { name: "Save schedule" })
    );
    await waitFor(() =>
      expect(mockedApi.setCampaignRecurrence).toHaveBeenCalledWith(
        "cmp1",
        expect.objectContaining({ cronExpression: expect.any(String) })
      )
    );
  });

  it("duplicates a campaign", async () => {
    const user = userEvent.setup();
    setup([campaign()]);
    mockedApi.duplicateCampaign.mockResolvedValue({});
    renderCampaigns();
    await screen.findByText("Spring");
    await user.click(screen.getByLabelText("Duplicate campaign"));
    await user.click(await screen.findByRole("button", { name: "Duplicate" }));
    await waitFor(() =>
      expect(mockedApi.duplicateCampaign).toHaveBeenCalledWith("cmp1")
    );
  });

  it("deletes a campaign", async () => {
    const user = userEvent.setup();
    setup([campaign()]);
    mockedApi.deleteCampaign.mockResolvedValue(undefined);
    renderCampaigns();
    await screen.findByText("Spring");
    await user.click(screen.getByLabelText("Delete campaign"));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockedApi.deleteCampaign).toHaveBeenCalledWith("cmp1")
    );
  });

  it("pauses and resumes via the toggle for paused campaigns", async () => {
    const user = userEvent.setup();
    setup([campaign({ status: "PAUSED" })]);
    mockedApi.resumeCampaign.mockResolvedValue({});
    renderCampaigns();
    await screen.findByText("Spring");
    await user.click(screen.getByLabelText("Resume campaign"));
    await waitFor(() =>
      expect(mockedApi.resumeCampaign).toHaveBeenCalledWith("cmp1")
    );
  });

  it("shows a recurring description for cron campaigns", async () => {
    setup([
      campaign({
        status: "SCHEDULED",
        cronExpression: "0 9 * * 1",
        nextRunAt: "2030-01-01T09:00:00Z"
      })
    ]);
    renderCampaigns();
    await screen.findByText("Spring");
    // cronstrue renders a human description containing "Monday"
    expect(screen.getByText(/Monday/i)).toBeInTheDocument();
  });

  it("edits a draft campaign", async () => {
    const user = userEvent.setup();
    setup([campaign()]);
    mockedApi.updateCampaign.mockResolvedValue({});
    renderCampaigns();
    await screen.findByText("Spring");
    await user.click(screen.getByLabelText("Edit campaign"));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Spring 2");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" })
    );
    await waitFor(() =>
      expect(mockedApi.updateCampaign).toHaveBeenCalledWith(
        "cmp1",
        expect.objectContaining({ name: "Spring 2" })
      )
    );
  });

  it("pauses a sending campaign", async () => {
    const user = userEvent.setup();
    setup([campaign({ status: "SENDING" })]);
    mockedApi.pauseCampaign.mockResolvedValue({});
    renderCampaigns();
    await screen.findByText("Spring");
    await user.click(screen.getByLabelText("Pause campaign"));
    await waitFor(() =>
      expect(mockedApi.pauseCampaign).toHaveBeenCalledWith("cmp1")
    );
  });

  it("rejects an invalid advanced cron expression", async () => {
    const user = userEvent.setup();
    setup([campaign()]);
    renderCampaigns();
    await screen.findByText("Spring");
    await user.click(screen.getByLabelText("Schedule campaign"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Repeat on a schedule"));
    // switch frequency to advanced (first combobox is the Frequency select)
    await user.click(within(dialog).getAllByRole("combobox")[0]);
    await user.click(await screen.findByRole("option", { name: /Advanced/ }));
    await user.type(
      within(dialog).getByLabelText("Cron expression"),
      "not a cron"
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save schedule" })
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Enter a valid schedule.")
    );
    expect(mockedApi.setCampaignRecurrence).not.toHaveBeenCalled();
  });

  it("toasts on load failure", async () => {
    mockedApi.listCampaigns.mockRejectedValue(new Error("cfail"));
    mockedApi.listTemplates.mockResolvedValue(templates);
    mockedApi.listContactLists.mockResolvedValue(lists);
    renderCampaigns();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("cfail"));
  });
});
