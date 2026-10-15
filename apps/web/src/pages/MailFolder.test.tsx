import { useSearchParams, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../test/render.js";
import { api } from "../lib/api.js";
import { MailFolder } from "./MailFolder.js";
const viewport = vi.hoisted(() => ({ desktop: false }));
const session = vi.hoisted(() => ({
  user: { id: "u1" },
  currentOrganizationId: "org1",
}));
vi.mock("../lib/session-context.js", () => ({ useSession: () => session }));
vi.mock("../lib/reading-preference.js", () => ({
  useReadingPreference: () => "pane",
}));
vi.mock("../lib/use-media-query.js", () => ({
  useMediaQuery: () => viewport.desktop,
  useIsMobile: () => !viewport.desktop,
}));
vi.mock("../lib/api.js", () => ({
  api: {
    searchMail: vi.fn(),
    searchableMailboxes: vi.fn(),
    getEmailDraft: vi.fn(),
    cancelOutboxEmail: vi.fn(),
    deleteEmailDraft: vi.fn(),
  },
}));
vi.mock("./Inbox.js", () => ({
  Inbox: ({ backLabel }: { backLabel: string }) => {
    const [params, setParams] = useSearchParams();
    return (
      <>
        <p>Received reader {params.get("message")}</p>
        <button
          onClick={() => {
            const next = new URLSearchParams(params);
            next.delete("message");
            setParams(next);
          }}
        >
          Back to {backLabel}
        </button>
      </>
    );
  },
}));
vi.mock("./SentMessage.js", () => ({
  SentMessage: ({
    messageId,
    onBack,
  }: {
    messageId: string;
    onBack: () => void;
  }) => (
    <>
      <p>Outgoing reader {messageId}</p>
      <button onClick={onBack}>Back to mail list</button>
    </>
  ),
}));
const received = {
  id: "in1",
  kind: "RECEIVED",
  messageId: "<in1>",
  subject: "Customer question",
  fromEmail: "customer@example.com",
  fromName: "Customer",
  to: ["support@example.com"],
  cc: [],
  at: "2026-10-15T10:00:00Z",
  preview: "Question body",
  mailboxEmail: "support@example.com",
  inboxAccountId: "a1",
  smtpConnectionId: null,
  status: null,
  read: false,
  label: "Received",
};
const sent = {
  ...received,
  id: "job1",
  kind: "SENT",
  subject: "My answer",
  status: "SENT",
  label: "Sent",
  read: true,
};
function History() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Current URL">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => navigate(-1)}>Browser Back</button>
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  viewport.desktop = false;
  session.currentOrganizationId = "org1";
  vi.mocked(api.searchMail).mockResolvedValue({
    rows: [received, sent],
    nextCursor: null,
  } as never);
  vi.mocked(api.searchableMailboxes).mockResolvedValue([
    { email: "support@example.com", name: "Support" },
  ]);
  vi.mocked(api.cancelOutboxEmail).mockResolvedValue({
    status: "CANCELLED",
  } as never);
  vi.mocked(api.deleteEmailDraft).mockResolvedValue(undefined);
});
describe("mail reading workspace", () => {
  it("searches received and sent mail together and restores selection through browser Back", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <MailFolder />
        <History />
      </>,
      { route: "/search?q=customer&address=support%40example.com" }
    );
    await user.click(
      await screen.findByRole("button", { name: "Open Customer question" })
    );
    expect(await screen.findByText("Received reader in1")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Search mail" })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Browser Back" }));
    expect(
      await screen.findByRole("heading", { name: "Search mail" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Search received and sent mail" })
    ).toHaveValue("customer");
    expect(screen.getByLabelText("Current URL")).toHaveTextContent(
      "address=support%40example.com"
    );
    await user.click(screen.getByRole("button", { name: "Open My answer" }));
    expect(await screen.findByText("Outgoing reader job1")).toBeInTheDocument();
  });
  it("keeps the list beside a selected reader on desktop", async () => {
    viewport.desktop = true;
    const user = userEvent.setup();
    renderWithProviders(<MailFolder view="SENT" />);
    await user.click(
      await screen.findByRole("button", { name: "Open My answer" })
    );
    expect(await screen.findByText("Outgoing reader job1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sent" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Delivery reports and filters" })
    ).toBeInTheDocument();
  });
  it("loads older pages without dropping already loaded results", async () => {
    vi.mocked(api.searchMail)
      .mockResolvedValueOnce({ rows: [received], nextCursor: "next" } as never)
      .mockResolvedValue({ rows: [sent], nextCursor: null } as never);
    const user = userEvent.setup();
    renderWithProviders(<MailFolder />);
    await user.click(
      await screen.findByRole("button", { name: "Load older mail" })
    );
    expect(await screen.findByText("My answer")).toBeInTheDocument();
    expect(screen.getByText("Customer question")).toBeInTheDocument();
    expect(api.searchMail).toHaveBeenLastCalledWith(
      "org1",
      expect.objectContaining({ cursor: "next" })
    );
  });
  it("opens a deep-linked personal draft with its files and resumes writing", async () => {
    vi.mocked(api.getEmailDraft).mockResolvedValue({
      id: "draft1",
      subject: "Unfinished",
      html: "<p>Saved writing</p>",
      to: ["one@example.com"],
      cc: [],
      bcc: [],
      attachments: [{ id: "f1", filename: "private.txt" }],
    } as never);
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <MailFolder view="DRAFTS" />
        <History />
      </>,
      { route: "/drafts?draft=draft1" }
    );
    expect(await screen.findByText("private.txt")).toBeInTheDocument();
    expect(screen.getByTitle("Saved draft preview")).toHaveAttribute(
      "srcdoc",
      "<p>Saved writing</p>"
    );
    await user.click(screen.getByRole("button", { name: "Keep writing" }));
    expect(screen.getByLabelText("Current URL")).toHaveTextContent(
      "/email-studio?draft=draft1"
    );
  });
  it("cancels only explicitly confirmed remaining deliveries", async () => {
    vi.mocked(api.searchMail).mockResolvedValue({
      rows: [{ ...sent, status: "QUEUED" }],
      nextCursor: null,
    } as never);
    const user = userEvent.setup();
    renderWithProviders(<MailFolder view="OUTBOX" />, {
      route: "/outbox?job=job1",
    });
    await user.click(
      await screen.findByRole("button", { name: "Cancel remaining deliveries" })
    );
    expect(api.cancelOutboxEmail).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", {
        name: "Cancel remaining deliveries",
        exact: true,
      })
    );
    await waitFor(() =>
      expect(api.cancelOutboxEmail).toHaveBeenCalledWith("job1", "org1")
    );
  });
  it("recovers an initial load failure without claiming an empty mailbox", async () => {
    vi.mocked(api.searchMail)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ rows: [received], nextCursor: null } as never);
    const user = userEvent.setup();
    renderWithProviders(<MailFolder />);
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Customer question")).toBeInTheDocument();
  });
  it("clears a selected private message and mailbox when changing organizations", async () => {
    const view = renderWithProviders(
      <>
        <MailFolder />
        <History />
      </>,
      { route: "/search?job=job1&address=support%40example.com" }
    );
    await screen.findByText("Outgoing reader job1");
    session.currentOrganizationId = "org2";
    view.rerender(
      <>
        <MailFolder />
        <History />
      </>
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Current URL")).toHaveTextContent(
        /^\/search$/
      )
    );
  });
});

it("keeps typing focused while a debounced search updates the URL", async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <>
      <MailFolder />
      <History />
    </>
  );
  const input = await screen.findByRole("textbox", {
    name: "Search received and sent mail",
  });
  await user.type(input, "new query");
  await waitFor(() =>
    expect(screen.getByLabelText("Current URL")).toHaveTextContent(
      "q=new+query"
    )
  );
  expect(input).toHaveFocus();
});

it("restores a scrolled desktop list and keyboard focus after closing a message", async () => {
  viewport.desktop = true;
  const user = userEvent.setup();
  renderWithProviders(<MailFolder />);
  const open = await screen.findByRole("button", { name: "Open My answer" });
  const list = screen.getByRole("region", { name: "Mail list" });
  Object.defineProperty(list, "scrollTop", { value: 140, writable: true });
  open.focus();
  await user.keyboard("{Enter}");
  await screen.findByText("Outgoing reader job1");
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Reading pane" })).toHaveFocus()
  );
  await user.click(screen.getByRole("button", { name: "Back to mail list" }));
  await waitFor(() => expect(list.scrollTop).toBe(140));
});
it("removes a personal draft only after confirmation and returns to its list", async () => {
  vi.mocked(api.getEmailDraft).mockResolvedValue({
    id: "draft1",
    subject: "Unfinished",
    html: "<p>Saved</p>",
    to: [],
    cc: [],
    bcc: [],
    attachments: [],
  } as never);
  const user = userEvent.setup();
  renderWithProviders(<MailFolder view="DRAFTS" />, {
    route: "/drafts?draft=draft1",
  });
  await user.click(await screen.findByRole("button", { name: "Remove draft" }));
  await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  expect(api.deleteEmailDraft).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Remove draft" }));
  await user.click(
    screen.getByRole("button", { name: "Remove draft", exact: true })
  );
  await waitFor(() =>
    expect(api.deleteEmailDraft).toHaveBeenCalledWith("draft1")
  );
  expect(
    await screen.findByRole("heading", { name: "Drafts" })
  ).toBeInTheDocument();
});
it("retries mailbox choices and narrows the server search without losing the phrase", async () => {
  vi.mocked(api.searchableMailboxes)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue([{ email: "support@example.com", name: "Support" }]);
  const user = userEvent.setup();
  renderWithProviders(<MailFolder />, { route: "/search?q=question" });
  await user.click(
    await screen.findByRole("button", { name: "Retry mailbox choices" })
  );
  await user.click(screen.getByRole("combobox", { name: "Search mailbox" }));
  await user.click(
    await screen.findByRole("option", { name: "support@example.com" })
  );
  await waitFor(() =>
    expect(api.searchMail).toHaveBeenLastCalledWith(
      "org1",
      expect.objectContaining({ q: "question", mailbox: "support@example.com" })
    )
  );
  await user.click(screen.getByRole("button", { name: "Refresh Search mail" }));
  await waitFor(() =>
    expect(vi.mocked(api.searchMail).mock.calls.length).toBeGreaterThan(2)
  );
});
it("recovers a draft load failure and directs a completed draft to its accepted message", async () => {
  vi.mocked(api.getEmailDraft)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({
      id: "draft1",
      subject: "Already accepted",
      html: "<p>Kept</p>",
      to: [],
      cc: [],
      bcc: [],
      attachments: [],
      completedSendId: "accepted1",
    } as never);
  const user = userEvent.setup();
  renderWithProviders(
    <>
      <MailFolder view="DRAFTS" />
      <History />
    </>,
    { route: "/drafts?draft=draft1" }
  );
  await user.click(
    await screen.findByRole("button", { name: "Try opening again" })
  );
  await user.click(
    await screen.findByRole("button", { name: "Review accepted message" })
  );
  expect(screen.getByLabelText("Current URL")).toHaveTextContent(
    "/sent?job=accepted1"
  );
});
