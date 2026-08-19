import { renderWithProviders, screen, waitFor } from "../test/render.js";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

vi.mock("../lib/api.js", () => ({
  api: { listSentEmails: vi.fn(), listSMTPConnections: vi.fn() },
}));

vi.mock("../lib/session-context.js", () => ({
  useSession: () => ({ currentOrganizationId: "org_1" }),
}));

import { api } from "../lib/api.js";
import { Sent } from "./Sent.js";

const mockedApi = api as unknown as {
  listSentEmails: ReturnType<typeof vi.fn>;
  listSMTPConnections: ReturnType<typeof vi.fn>;
};

const email = {
  id: "job_1",
  subject: "Friday update",
  to: ["a@x.com", "b@x.com", "c@x.com"],
  ccCount: 1,
  bccCount: 0,
  status: "SENT" as const,
  origin: "MANUAL" as const,
  sentAt: "2026-07-22T09:00:00.000Z",
  createdAt: "2026-07-22T08:59:00.000Z",
  campaignId: null,
  campaignName: null,
  sendingAccount: {
    name: "Primary",
    fromEmail: "hi@acme.com",
    fromName: "Acme",
  },
  delivered: true,
  bounced: false,
  complained: false,
  opens: 0,
  clicks: 0,
};

function page(rows: unknown[], total = rows.length) {
  return { rows, total, page: 1, pageSize: 25 };
}

/**
 * Renders the page with the current URL on screen.
 *
 * Both halves of this page's routing are worth asserting: a row opens a message
 * at its own address, and the filters live in the query string so that coming
 * back from one restores the archive you left.
 */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="url">{location.pathname + location.search}</div>;
}

function renderSent() {
  return renderWithProviders(
    <>
      <Sent />
      <LocationProbe />
    </>
  );
}

function url() {
  return screen.getByTestId("url").textContent;
}

/** The query object the page sent on its most recent request. */
function lastQuery() {
  const calls = mockedApi.listSentEmails.mock.calls;
  return calls[calls.length - 1][0];
}

describe("Sent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.listSentEmails.mockResolvedValue(page([email]));
    mockedApi.listSMTPConnections.mockResolvedValue([
      { id: "smtp_1", name: "Primary", fromEmail: "hi@acme.com" },
      { id: "smtp_2", name: "Support", fromEmail: "help@acme.com" },
    ]);
  });

  it("shows what went out and how it landed", async () => {
    renderSent();

    expect(await screen.findByText("Friday update")).toBeInTheDocument();
    expect(screen.getByText("Delivered")).toBeInTheDocument();
    // Three recipients and one Cc: two are listed, the rest are counted.
    expect(screen.getByText("a@x.com, b@x.com +2 more")).toBeInTheDocument();
  });

  it("keeps the sending account out of the table", async () => {
    renderSent();
    await screen.findByText("Friday update");

    // A fifth column of mail-shaped text does not fit the 736px a 1024px laptop
    // leaves, and the account repeats down the page anyway. It lives in the
    // "Sent from" filter, and on the message's own page.
    expect(screen.queryByText("Acme <hi@acme.com>")).not.toBeInTheDocument();
  });

  it("names the strongest thing that happened, not the first", async () => {
    mockedApi.listSentEmails.mockResolvedValue(
      page([{ ...email, opens: 4, clicks: 2 }])
    );
    renderSent();

    // Delivered *and* opened *and* clicked — the row has one line to say it.
    expect(await screen.findByText("Clicked")).toBeInTheDocument();
    expect(screen.queryByText("Delivered")).not.toBeInTheDocument();
    expect(screen.getByText("4 opens · 2 clicks")).toBeInTheDocument();
  });

  it("calls a bounce a bounce even when the job status is SENT", async () => {
    mockedApi.listSentEmails.mockResolvedValue(
      page([{ ...email, delivered: false, bounced: true, opens: 1 }])
    );
    renderSent();

    expect(await screen.findByText("Bounced")).toBeInTheDocument();
  });

  it("shows a failed send as failed", async () => {
    mockedApi.listSentEmails.mockResolvedValue(
      page([{ ...email, status: "FAILED", delivered: false, sentAt: null }])
    );
    renderSent();

    expect(await screen.findByText("Failed")).toBeInTheDocument();
  });

  it("opens on the mail you wrote yourself", async () => {
    renderSent();
    await screen.findByText("Friday update");

    /*
      Not "all types". One campaign to a 10,000-address list puts 10,000 rows in
      front of someone looking for the message they sent a customer on Tuesday,
      and no amount of paging gets them past it.
    */
    expect(lastQuery()).toMatchObject({
      organizationId: "org_1",
      q: undefined,
      origin: "MANUAL",
      outcome: "all",
      smtpConnectionId: undefined,
      days: 0,
      page: 1,
      pageSize: 25,
    });
    // The default is the absence of a parameter, not a redundant one.
    expect(url()).toBe("/");
  });

  it("widens to every type on request, and says so in the URL", async () => {
    const user = userEvent.setup();
    renderSent();
    await screen.findByText("Friday update");

    await user.click(screen.getByLabelText("Type"));
    await user.click(await screen.findByRole("option", { name: "All types" }));

    // "all" is a departure from the default here, so it has to be carried
    // explicitly — otherwise the link would reopen on MANUAL.
    await waitFor(() => expect(lastQuery()).toMatchObject({ origin: "all" }));
    expect(url()).toContain("origin=all");
  });

  it("searches on the server, debounced, from the first page", async () => {
    const user = userEvent.setup();
    renderSent();
    await screen.findByText("Friday update");

    await user.type(screen.getByLabelText("Search"), "launch");

    // Not once per keystroke: this is the biggest table the org has.
    await waitFor(() => expect(lastQuery()).toMatchObject({ q: "launch" }));
    expect(mockedApi.listSentEmails.mock.calls.length).toBeLessThan(6);
  });

  it("filters by outcome without touching the other filters", async () => {
    const user = userEvent.setup();
    renderSent();
    await screen.findByText("Friday update");

    await user.click(screen.getByLabelText("Outcome"));
    await user.click(await screen.findByRole("option", { name: "Bounced" }));

    await waitFor(() =>
      expect(lastQuery()).toMatchObject({ outcome: "bounced", origin: "MANUAL" })
    );
  });

  it("filters by sending account using the org's real accounts", async () => {
    const user = userEvent.setup();
    renderSent();
    await screen.findByText("Friday update");

    await user.click(screen.getByLabelText("Sent from"));
    await user.click(await screen.findByRole("option", { name: "Support" }));

    await waitFor(() =>
      expect(lastQuery()).toMatchObject({ smtpConnectionId: "smtp_2" })
    );
  });

  it("filters by date window and by type", async () => {
    const user = userEvent.setup();
    renderSent();
    await screen.findByText("Friday update");

    await user.click(screen.getByLabelText("When"));
    await user.click(await screen.findByRole("option", { name: "Last 7 days" }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ days: 7 }));

    await user.click(screen.getByLabelText("Type"));
    await user.click(await screen.findByRole("option", { name: "Campaign" }));
    await waitFor(() =>
      expect(lastQuery()).toMatchObject({ days: 7, origin: "CAMPAIGN" })
    );
  });

  it("returns to page 1 when a filter changes", async () => {
    const user = userEvent.setup();
    mockedApi.listSentEmails.mockResolvedValue({
      rows: [email],
      total: 120,
      page: 1,
      pageSize: 25,
    });
    renderSent();
    await screen.findByText("Friday update");

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ page: 2 }));

    // Page 3 of the old result set is a different set of emails; landing on an
    // empty page after narrowing a filter reads as a bug.
    await user.click(screen.getByLabelText("Outcome"));
    await user.click(await screen.findByRole("option", { name: "Opened" }));
    await waitFor(() =>
      expect(lastQuery()).toMatchObject({ page: 1, outcome: "opened" })
    );
  });

  it("pages against the server's total, not the rows on screen", async () => {
    mockedApi.listSentEmails.mockResolvedValue({
      rows: [email],
      total: 120,
      page: 1,
      pageSize: 25,
    });
    renderSent();
    await screen.findByText("Friday update");

    expect(screen.getByText(/Page 1 of 5 · 120 emails/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("does not offer column sorting it could not honour", async () => {
    renderSent();
    await screen.findByText("Friday update");

    // The grid holds one page of an archive that can run to six figures, so a
    // header sort would reorder 25 rows and present it as the whole order.
    expect(
      screen.queryByRole("button", { name: /^Outcome$/ })
    ).not.toBeInTheDocument();
  });

  it("opens a row at the message's own address", async () => {
    const user = userEvent.setup();
    renderSent();
    await user.click(await screen.findByText("Friday update"));

    // A route, not a dialog: the body of an email is a document — long enough
    // to scroll, and worth linking to.
    await waitFor(() => expect(url()).toBe("/sent/job_1"));
  });

  it("keeps the filters in the URL, so coming back restores them", async () => {
    const user = userEvent.setup();
    renderSent();
    await screen.findByText("Friday update");

    await user.click(screen.getByLabelText("Outcome"));
    await user.click(await screen.findByRole("option", { name: "Opened" }));

    // React Router restores no component state on the way back from a message,
    // so held in `useState` these were lost the moment a row was opened.
    await waitFor(() => expect(url()).toContain("outcome=opened"));
  });

  it("says the archive is empty differently from a filter matching nothing", async () => {
    const user = userEvent.setup();
    mockedApi.listSentEmails.mockResolvedValue(page([]));
    renderSent();

    // Says what is missing rather than "nothing sent yet", which would be a lie
    // to an org whose mail is all campaigns or all API sends.
    expect(
      await screen.findByText("Nothing written by you yet")
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText("Outcome"));
    await user.click(await screen.findByRole("option", { name: "Bounced" }));

    expect(
      await screen.findByText("No emails match these filters")
    ).toBeInTheDocument();
  });

  it("clears every filter at once", async () => {
    const user = userEvent.setup();
    renderSent();
    await screen.findByText("Friday update");

    await user.type(screen.getByLabelText("Search"), "launch");
    await user.click(screen.getByLabelText("Outcome"));
    await user.click(await screen.findByRole("option", { name: "Opened" }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ q: "launch" }));

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() =>
      expect(lastQuery()).toMatchObject({
        q: undefined,
        outcome: "all",
        // Back to the default, which is MANUAL rather than every type.
        origin: "MANUAL",
        days: 0,
        page: 1,
      })
    );
    expect(screen.getByLabelText("Search")).toHaveValue("");
  });
});
