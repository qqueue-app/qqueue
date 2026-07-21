import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

vi.mock("../lib/api.js", () => ({
  api: {
    listInboxAccounts: vi.fn(),
    listInboundMessages: vi.fn(),
    markInboundMessageRead: vi.fn(),
    replyToInboundMessage: vi.fn(),
    createInboxAccount: vi.fn(),
    deleteInboxAccount: vi.fn(),
    downloadInboundAttachment: vi.fn()
  }
}));

vi.mock("../lib/session-context.js", () => ({
  useSession: () => ({ currentOrganizationId: "org_1" })
}));

import { api } from "../lib/api.js";
import { Inbox } from "./Inbox.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    organizationId: "org_1",
    inboxAccountId: "acc_1",
    messageId: "<m1@example.com>",
    references: [],
    fromEmail: "sender@example.com",
    fromName: "Sender",
    to: ["support@acme.test"],
    cc: [],
    subject: "Quarterly numbers",
    text: "plain text fallback",
    html: null,
    receivedAt: "2026-07-01T10:00:00.000Z",
    readAt: null,
    ...overrides
  };
}

function setup(messages: Record<string, unknown>[]) {
  mockedApi.listInboxAccounts.mockResolvedValue([
    {
      id: "acc_1",
      organizationId: "org_1",
      name: "Support",
      email: "support@acme.test",
      host: "imap.acme.test",
      port: 993,
      secure: true,
      mailbox: "INBOX",
      status: "ACTIVE"
    }
  ]);
  mockedApi.listInboundMessages.mockResolvedValue({ data: messages });
  mockedApi.markInboundMessageRead.mockImplementation(async (id: string) =>
    makeMessage({ id, readAt: "2026-07-02T00:00:00.000Z" })
  );
}

/**
 * The conversation list row. The first thread is auto-selected on load, so the
 * subject also appears in the detail pane — queries that mean "the list row"
 * must be scoped, or they match two elements.
 */
async function findRow(subject = /Quarterly numbers/) {
  return screen.findByRole("button", { name: subject });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Inbox read/unread emphasis", () => {
  // The reported bug: every row rendered bold, so "unread" carried no signal.
  it("bolds an unread conversation's sender and subject", async () => {
    setup([makeMessage({ readAt: null })]);
    render(<Inbox />);

    const row = await findRow();
    expect(
      within(row).getByText("Quarterly numbers").className
    ).toContain("font-semibold");
    expect(
      within(row).getByText(/Sender </).className
    ).toContain("font-semibold");
  });

  it("does not bold a conversation that has been read", async () => {
    setup([makeMessage({ readAt: "2026-07-01T12:00:00.000Z" })]);
    render(<Inbox />);

    const row = await findRow();
    const subject = within(row).getByText("Quarterly numbers");
    expect(subject.className).not.toContain("font-semibold");
    expect(subject.className).toContain("font-normal");
    expect(
      within(row).getByText(/Sender </).className
    ).not.toContain("font-semibold");
  });

  it("shows the unread badge only while unread", async () => {
    setup([makeMessage({ readAt: "2026-07-01T12:00:00.000Z" })]);
    render(<Inbox />);

    const row = await findRow();
    expect(within(row).queryByText(/unread/i)).not.toBeInTheDocument();
  });
});

describe("Inbox message body rendering", () => {
  // The reported bug: an HTML message (e.g. containing a table) was displayed
  // as mailparser's flattened text/plain alternative.
  it("renders the HTML part in a sandboxed frame rather than the text part", async () => {
    setup([
      makeMessage({
        html: "<table><tr><td>Q1</td><td>42</td></tr></table>",
        text: "Q1 42"
      })
    ]);
    render(<Inbox />);

    const frame = await screen.findByTitle(/^Message from/);
    expect(frame.tagName).toBe("IFRAME");
    // The table markup survives into the frame document.
    expect(frame.getAttribute("srcdoc")).toContain("<table>");
    // Scripts can never run: the sandbox does not grant allow-scripts, and the
    // CSP blocks them independently.
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
  });

  it("falls back to the text part when there is no HTML", async () => {
    setup([makeMessage({ html: null, text: "plain text fallback" })]);
    render(<Inbox />);

    await findRow();
    expect(screen.queryByTitle(/^Message from/)).not.toBeInTheDocument();
    // Rendered as text in the detail pane, not as markup.
    expect(screen.getAllByText("plain text fallback").length).toBeGreaterThan(0);
  });

  it("blocks remote images until the reader opts in", async () => {
    const user = userEvent.setup();
    setup([makeMessage({ html: '<img src="https://tracker.test/pixel.gif">' })]);
    render(<Inbox />);

    const frame = await screen.findByTitle(/^Message from/);
    // Blocked: img-src permits data: only, so the tracking pixel never loads.
    expect(frame.getAttribute("srcdoc")).toContain("img-src data:;");

    await user.click(screen.getByRole("button", { name: /show images/i }));

    const unblocked = await screen.findByTitle(/^Message from/);
    expect(unblocked.getAttribute("srcdoc")).toContain("img-src data: https:");
    expect(
      screen.queryByRole("button", { name: /show images/i })
    ).not.toBeInTheDocument();
  });
});

describe("Inbox attachments", () => {
  const withAttachment = () =>
    makeMessage({
      attachments: [
        {
          id: "att_1",
          filename: "report.pdf",
          contentType: "application/pdf",
          size: 2048,
          isInline: false
        }
      ]
    });

  it("lists a received attachment with its size", async () => {
    setup([withAttachment()]);
    render(<Inbox />);

    expect(await screen.findByText("Attachments")).toBeInTheDocument();
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
  });

  it("hides inline parts so a signature image isn't listed as a download", async () => {
    setup([
      makeMessage({
        attachments: [
          {
            id: "att_2",
            filename: "logo.png",
            contentType: "image/png",
            size: 512,
            isInline: true
          }
        ]
      })
    ]);
    render(<Inbox />);

    await findRow();
    expect(screen.queryByText("logo.png")).not.toBeInTheDocument();
    expect(screen.queryByText("Attachments")).not.toBeInTheDocument();
  });

  it("downloads an attachment through the authenticated endpoint", async () => {
    const user = userEvent.setup();
    setup([withAttachment()]);
    mockedApi.downloadInboundAttachment.mockResolvedValue(
      new Blob(["pdf"], { type: "application/pdf" })
    );
    // jsdom provides no object-URL plumbing.
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    render(<Inbox />);
    await user.click(await screen.findByRole("button", { name: /report\.pdf/ }));

    await waitFor(() => {
      expect(mockedApi.downloadInboundAttachment).toHaveBeenCalledWith({
        messageId: "m1",
        attachmentId: "att_1",
        organizationId: "org_1"
      });
    });
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it("surfaces a download failure instead of failing silently", async () => {
    const user = userEvent.setup();
    setup([withAttachment()]);
    mockedApi.downloadInboundAttachment.mockRejectedValue(new Error("nope"));

    render(<Inbox />);
    await user.click(await screen.findByRole("button", { name: /report\.pdf/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Unable to download attachment");
    });
  });
});

describe("Inbox list preview", () => {
  it("derives a snippet from HTML instead of showing a placeholder", async () => {
    setup([
      makeMessage({
        text: null,
        html: "<style>p{color:red}</style><p>Real preview text</p>"
      })
    ]);
    render(<Inbox />);

    const row = await findRow();
    expect(within(row).getByText(/Real preview text/)).toBeInTheDocument();
    // Stylesheet contents must not leak into the preview.
    expect(within(row).queryByText(/color:red/)).not.toBeInTheDocument();
    expect(within(row).queryByText("HTML message")).not.toBeInTheDocument();
  });
});

describe("Inbox mark-as-read", () => {
  it("marks unread messages read when the conversation is opened", async () => {
    const user = userEvent.setup();
    setup([makeMessage({ readAt: null })]);
    render(<Inbox />);

    await user.click(await findRow());

    await waitFor(() => {
      expect(mockedApi.markInboundMessageRead).toHaveBeenCalledWith("m1", {
        organizationId: "org_1",
        read: true
      });
    });
  });

  it("does not re-mark a conversation that is already read", async () => {
    const user = userEvent.setup();
    setup([makeMessage({ readAt: "2026-07-01T12:00:00.000Z" })]);
    render(<Inbox />);

    await user.click(await findRow());

    expect(mockedApi.markInboundMessageRead).not.toHaveBeenCalled();
  });
});

describe("Inbox empty state", () => {
  it("renders without messages", async () => {
    setup([]);
    render(<Inbox />);

    await waitFor(() => {
      expect(mockedApi.listInboundMessages).toHaveBeenCalled();
    });
    expect(screen.queryByText("Quarterly numbers")).not.toBeInTheDocument();
  });
});

describe("Inbox reply", () => {
  it("sends a reply through the reply form", async () => {
    const user = userEvent.setup();
    setup([makeMessage({ readAt: "2026-07-01T12:00:00.000Z" })]);
    mockedApi.replyToInboundMessage.mockResolvedValue({
      id: "job_1",
      status: "QUEUED"
    });
    render(<Inbox />);

    const box = await screen.findByPlaceholderText(/Reply to sender@example/);
    await user.type(box, "Thanks!");
    await user.click(screen.getByRole("button", { name: /send reply/i }));

    await waitFor(() => {
      expect(mockedApi.replyToInboundMessage).toHaveBeenCalledWith(
        "m1",
        expect.objectContaining({
          organizationId: "org_1",
          text: "Thanks!"
        })
      );
    });
  });

  it("surfaces a reply failure", async () => {
    const user = userEvent.setup();
    setup([makeMessage({ readAt: "2026-07-01T12:00:00.000Z" })]);
    mockedApi.replyToInboundMessage.mockRejectedValue(new Error("smtp down"));
    render(<Inbox />);

    const box = await screen.findByPlaceholderText(/Reply to sender@example/);
    await user.type(box, "Hi");
    await user.click(screen.getByRole("button", { name: /send reply/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("smtp down"));
  });
});

describe("Inbox filters", () => {
  it("re-queries with a search term", async () => {
    const user = userEvent.setup();
    setup([makeMessage()]);
    render(<Inbox />);
    await findRow();

    await user.type(screen.getByPlaceholderText("Search inbox"), "invoice");
    await user.click(screen.getByRole("button", { name: "Search inbox" }));

    await waitFor(() => {
      expect(mockedApi.listInboundMessages).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "invoice" })
      );
    });
  });
});

describe("Inbox accounts", () => {
  it("connects a new inbox account", async () => {
    const user = userEvent.setup();
    setup([]);
    mockedApi.createInboxAccount.mockResolvedValue({ id: "acc_2" });
    render(<Inbox />);

    await user.click(
      await screen.findByRole("button", { name: /connect an inbox/i })
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Sales");
    await user.type(
      within(dialog).getByLabelText("Email"),
      "sales@acme.test"
    );
    await user.type(
      within(dialog).getByLabelText("Mail server"),
      "imap.acme.test"
    );
    await user.type(
      within(dialog).getByLabelText("Username"),
      "sales@acme.test"
    );
    await user.type(within(dialog).getByLabelText("Password"), "secret");
    await user.click(
      within(dialog).getByRole("button", { name: /^connect$/i })
    );

    await waitFor(() => {
      expect(mockedApi.createInboxAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          name: "Sales",
          email: "sales@acme.test",
          host: "imap.acme.test"
        })
      );
    });
  });

  it("removes an inbox account", async () => {
    const user = userEvent.setup();
    setup([]);
    mockedApi.deleteInboxAccount.mockResolvedValue(undefined);
    render(<Inbox />);

    // The remove control is disabled while the filter is on "all accounts".
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Support/ }));
    await user.click(screen.getByLabelText("Remove this inbox"));

    await waitFor(() =>
      expect(mockedApi.deleteInboxAccount).toHaveBeenCalledWith(
        "acc_1",
        "org_1"
      )
    );
  });
});
