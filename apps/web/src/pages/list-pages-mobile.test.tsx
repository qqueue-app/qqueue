import { renderWithProviders, screen } from "../test/render.js";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The mobile half of the list-page sweep.
 *
 * Every one of these pages hands its rows to the same `<DataGrid>`, and the
 * grid only transforms a table into stacked cards when the page supplies
 * `renderMobileRow` — omit it and the page silently falls back to a table that
 * has to scroll sideways on a phone, which §5 rules out twice. That omission is
 * invisible on a desktop test run, so it gets its own file: one case per page,
 * each asserting the table is *absent* (not hidden — a hidden copy leaves every
 * row in the accessibility tree twice) and the row's content still readable.
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

vi.mock("../lib/session-context.js", () => ({
  useSession: () => ({ currentOrganizationId: "org_1" }),
}));

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom"
    );
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("../lib/api.js", () => ({
  api: {
    listEmailDrafts: vi.fn(),
    listOutbox: vi.fn(),
    listContactLists: vi.fn(),
    listContacts: vi.fn(),
    listSegments: vi.fn(),
    listCampaigns: vi.fn(),
    listTemplates: vi.fn(),
  },
}));

import { api } from "../lib/api.js";
import { Campaigns } from "./Campaigns.js";
import { ContactLists } from "./ContactLists.js";
import { Drafts } from "./Drafts.js";
import { Outbox } from "./Outbox.js";
import { Segments } from "./Segments.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

let restore: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  restore = useMobileViewport();
  mockedApi.listEmailDrafts.mockResolvedValue([
    {
      id: "drf_1",
      organizationId: "org_1",
      createdByUserId: "usr_1",
      subject: "Half-written",
      to: ["a@x.com"],
      cc: [],
      bcc: [],
      contactIds: [],
      listIds: [],
      createdAt: "2026-07-20T09:00:00.000Z",
      updatedAt: "2026-07-21T09:00:00.000Z",
    },
  ]);
  mockedApi.listOutbox.mockResolvedValue([
    {
      id: "job_1",
      subject: "Goes out later",
      to: ["queued@x.com"],
      ccCount: 0,
      bccCount: 0,
      status: "QUEUED",
      origin: "MANUAL",
      scheduledAt: null,
      campaignName: null,
      sendingAccount: {
        id: "smtp_1",
        name: "Primary",
        fromEmail: "me@x.com",
        fromName: null,
      },
    },
  ]);
  mockedApi.listContactLists.mockResolvedValue([
    {
      id: "lst_1",
      name: "Newsletter",
      description: "Everyone who opted in",
      contacts: [],
      _count: { contacts: 3, campaigns: 0 },
    },
  ]);
  mockedApi.listContacts.mockResolvedValue([]);
  mockedApi.listSegments.mockResolvedValue([
    {
      id: "seg_1",
      name: "VIPs",
      rules: { combinator: "AND", conditions: [{ tags: { any: ["vip"] } }] },
      createdAt: "2026-07-20T09:00:00.000Z",
    },
  ]);
  mockedApi.listCampaigns.mockResolvedValue([
    {
      id: "cmp_1",
      name: "Launch week",
      status: "DRAFT",
      template: { id: "tpl_1", name: "Launch", subject: "We're live" },
      contactList: { id: "lst_1", name: "Newsletter" },
      _count: { emailJobs: 0 },
    },
  ]);
  mockedApi.listTemplates.mockResolvedValue([]);
});

afterEach(() => restore());

function renderPage(element: React.ReactElement) {
  return renderWithProviders(<MemoryRouter>{element}</MemoryRouter>, {
    withRouter: false,
  });
}

describe("list pages on a phone", () => {
  it("Drafts renders drafts as cards, never a table", async () => {
    renderPage(<Drafts />);
    expect(await screen.findByText("Half-written")).toBeInTheDocument();

    expect(
      screen.queryByRole("table", { name: "Drafts" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("a@x.com")).toBeInTheDocument();
  });

  it("Outbox renders waiting mail as cards, never a table", async () => {
    renderPage(<Outbox />);
    expect(await screen.findByText("Goes out later")).toBeInTheDocument();

    expect(
      screen.queryByRole("table", { name: "Outbox" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Written by you")).toBeInTheDocument();
  });

  it("Lists renders lists as cards, never a table", async () => {
    renderPage(<ContactLists />);
    expect(await screen.findByText("Newsletter")).toBeInTheDocument();

    expect(
      screen.queryByRole("table", { name: "Contact lists" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Everyone who opted in")).toBeInTheDocument();
  });

  it("Smart lists renders segments as cards, never a table", async () => {
    renderPage(<Segments />);
    expect(await screen.findByText("VIPs")).toBeInTheDocument();

    expect(
      screen.queryByRole("table", { name: "Smart lists" })
    ).not.toBeInTheDocument();
  });

  it("Campaigns renders campaigns as cards, never a table", async () => {
    renderPage(<Campaigns />);
    expect(await screen.findByText("Launch week")).toBeInTheDocument();

    expect(
      screen.queryByRole("table", { name: "Campaigns" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("We're live")).toBeInTheDocument();
  });

  it("gives a tappable card its own hit area, separate from its row actions", async () => {
    const user = userEvent.setup();
    renderPage(<Drafts />);
    await screen.findByText("Half-written");

    // Two independent controls, not one nested in the other: the card's hit
    // area opens the draft, the action button deletes it. Nesting them (a
    // <button> card wrapping the ⋯ menu) is invalid HTML that browsers resolve
    // differently, and can swallow the inner control's activation entirely.
    const open = screen.getByRole("button", { name: "Open Half-written" });
    const remove = screen.getByRole("button", { name: "Delete draft" });
    expect(open).not.toContainElement(remove);
    expect(remove).not.toContainElement(open);

    await user.click(remove);
    expect(
      await screen.findByRole("heading", { name: "Delete this draft?" })
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps every list page's search field at one field width, not the container", async () => {
    renderPage(<Drafts />);
    const search = await screen.findByLabelText("Search drafts…");

    // §2's width table: 280px from 480px up, full width of the padded column
    // below it — where the column *is* the content width.
    expect(search.parentElement?.className).toContain("xs:w-field-search");
    expect(search.parentElement?.className).toContain("w-full");
  });
});
