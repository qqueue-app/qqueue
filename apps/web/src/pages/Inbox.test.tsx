import { renderWithProviders, screen, waitFor, within } from "../test/render.js";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  // Used by actions that report progress before their result.
  loading: vi.fn(),
  message: vi.fn()
}));
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

/** The conversation's row in the list. */
async function findRow(subject = /Quarterly numbers/) {
  return screen.findByRole("button", { name: subject });
}

/**
 * Open the conversation, which is what puts the reader on screen: the inbox
 * lists everything full-width and shows a message only once it is tapped, so
 * nothing is selected on load.
 */
async function openRow(user: ReturnType<typeof userEvent.setup>, subject = /Quarterly numbers/) {
  await user.click(await findRow(subject));
  return screen.findByRole("button", { name: /^inbox$/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom implements neither half of the object-URL API, which attachment
  // downloads and inline images both rely on.
  URL.createObjectURL = vi.fn(() => "blob:qqueue/inline-1");
  URL.revokeObjectURL = vi.fn();
});

describe("Inbox single-screen navigation", () => {
  // The list used to sit in a 22rem rail beside a permanently-open reader, and
  // the first conversation was auto-selected — so the inbox marked a message
  // read before anyone touched it.
  it("shows only the list until a conversation is tapped", async () => {
    setup([makeMessage({ readAt: null })]);
    renderWithProviders(<Inbox />);

    await findRow();
    expect(screen.queryByRole("button", { name: /^reply$/i })).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/Reply to Sender/)
    ).not.toBeInTheDocument();
    expect(mockedApi.markInboundMessageRead).not.toHaveBeenCalled();
  });

  it("opens the conversation full-width and comes back to the list", async () => {
    const user = userEvent.setup();
    setup([makeMessage({ readAt: "2026-07-01T12:00:00.000Z" })]);
    renderWithProviders(<Inbox />);

    const back = await openRow(user);
    // The reader replaces the list rather than sitting beside it.
    expect(screen.queryByPlaceholderText("Search mail")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Reply to Sender/)).toBeInTheDocument();

    await user.click(back);
    expect(await screen.findByPlaceholderText("Search mail")).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/Reply to Sender/)
    ).not.toBeInTheDocument();
  });

  it("marks a conversation unread and returns to the list", async () => {
    const user = userEvent.setup();
    setup([makeMessage({ readAt: "2026-07-01T12:00:00.000Z" })]);
    renderWithProviders(<Inbox />);
    await openRow(user);

    await user.click(screen.getByLabelText("Mark as unread"));

    await waitFor(() =>
      expect(mockedApi.markInboundMessageRead).toHaveBeenCalledWith("m1", {
        organizationId: "org_1",
        read: false
      })
    );
    // Staying in the reader would re-mark it read the moment it was reopened.
    expect(await screen.findByPlaceholderText("Search mail")).toBeInTheDocument();
  });
});

describe("Inbox read/unread emphasis", () => {
  // The reported bug: every row rendered bold, so "unread" carried no signal.
  it("bolds an unread conversation's sender and subject", async () => {
    setup([makeMessage({ readAt: null })]);
    renderWithProviders(<Inbox />);

    const row = await findRow();
    expect(
      within(row).getByText("Quarterly numbers").className
    ).toContain("font-semibold");
    expect(
      within(row).getByText("Sender").className
    ).toContain("font-semibold");
  });

  it("does not bold a conversation that has been read", async () => {
    setup([makeMessage({ readAt: "2026-07-01T12:00:00.000Z" })]);
    renderWithProviders(<Inbox />);

    const row = await findRow();
    const subject = within(row).getByText("Quarterly numbers");
    // A read row drops the bold and dims rather than switching to an explicit
    // font-normal class.
    expect(subject.className).not.toContain("font-semibold");
    expect(
      within(row).getByText("Sender").className
    ).not.toContain("font-semibold");
  });

  it("shows the unread badge only while unread", async () => {
    setup([makeMessage({ readAt: "2026-07-01T12:00:00.000Z" })]);
    renderWithProviders(<Inbox />);

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
    const user = userEvent.setup();
    renderWithProviders(<Inbox />);
    await openRow(user);

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
    const user = userEvent.setup();
    renderWithProviders(<Inbox />);
    await openRow(user);

    expect(screen.queryByTitle(/^Message from/)).not.toBeInTheDocument();
    // Rendered as text in the open conversation, not as markup.
    expect(screen.getAllByText("plain text fallback").length).toBeGreaterThan(0);
  });

  it("loads remote images without an opt-in", async () => {
    setup([makeMessage({ html: '<img src="https://tracker.test/pixel.gif">' })]);
    const user = userEvent.setup();
    renderWithProviders(<Inbox />);
    await openRow(user);

    const frame = await screen.findByTitle(/^Message from/);
    // Reading the mail is enough: img-src admits remote hosts and the src
    // survives into the body, so the image renders on open.
    expect(frame.getAttribute("srcdoc")).toContain("img-src data: blob: https:");
    expect(frame.getAttribute("srcdoc")).toContain("tracker.test");
    // No blocked-images prompt stands between the reader and the message.
    expect(
      screen.queryByRole("button", { name: /show images/i })
    ).not.toBeInTheDocument();
  });

  it("still refuses scripts and network fetches from a message body", async () => {
    setup([
      makeMessage({
        html: '<script>alert(1)</script><img src="https://tracker.test/p.gif">'
      })
    ]);
    const user = userEvent.setup();
    renderWithProviders(<Inbox />);
    await openRow(user);

    // Widening img-src must not widen anything else: the frame stays
    // script-less and default-src stays shut.
    const frame = await screen.findByTitle(/^Message from/);
    const srcdoc = frame.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("default-src 'none'");
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(srcdoc).not.toContain("allow-scripts");
  });

  // The reported bug: an embedded image (sender's logo, pasted screenshot)
  // rendered as a broken image, because nothing resolved its cid: reference.
  it("loads inline cid: images and renders them without an opt-in", async () => {
    setup([
      makeMessage({
        html: '<p>See below</p><img src="cid:logo@corp">',
        attachments: [
          {
            id: "att_1",
            filename: "logo.png",
            contentType: "image/png",
            size: 120,
            isInline: true,
            contentId: "<logo@corp>"
          }
        ]
      })
    ]);
    mockedApi.downloadInboundAttachment.mockResolvedValue(
      new Blob(["png"], { type: "image/png" })
    );
    const user = userEvent.setup();
    renderWithProviders(<Inbox />);
    await openRow(user);

    await waitFor(() =>
      expect(
        screen.getByTitle(/^Message from/).getAttribute("srcdoc")
      ).toContain("src=\"blob:")
    );
    expect(mockedApi.downloadInboundAttachment).toHaveBeenCalledWith({
      messageId: "m1",
      attachmentId: "att_1",
      organizationId: "org_1"
    });
    // Inline parts stay out of the downloadable attachment strip.
    expect(screen.queryByText("logo.png")).not.toBeInTheDocument();
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
    const user = userEvent.setup();
    setup([withAttachment()]);
    renderWithProviders(<Inbox />);
    await openRow(user);

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
    const user = userEvent.setup();
    renderWithProviders(<Inbox />);
    await openRow(user);

    expect(screen.queryByText("logo.png")).not.toBeInTheDocument();
    expect(screen.queryByText("Attachments")).not.toBeInTheDocument();
  });

  it("opens a previewable attachment in place instead of downloading it", async () => {
    const user = userEvent.setup();
    setup([withAttachment()]);
    mockedApi.downloadInboundAttachment.mockResolvedValue(
      new Blob(["pdf"], { type: "application/pdf" })
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");

    renderWithProviders(<Inbox />);
    await openRow(user);
    await user.click(await screen.findByRole("button", { name: /report\.pdf/ }));

    await waitFor(() => {
      expect(mockedApi.downloadInboundAttachment).toHaveBeenCalledWith({
        messageId: "m1",
        attachmentId: "att_1",
        organizationId: "org_1"
      });
    });
    // The viewer opens and nothing is saved to disk until the reader asks.
    expect(
      await screen.findByRole("dialog", { name: /report\.pdf/ })
    ).toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it("falls back to downloading a type the browser can't render", async () => {
    const user = userEvent.setup();
    setup([
      makeMessage({
        attachments: [
          {
            id: "att_2",
            filename: "books.xlsx",
            contentType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size: 4096,
            isInline: false
          }
        ]
      })
    ]);
    mockedApi.downloadInboundAttachment.mockResolvedValue(
      new Blob(["xlsx"], { type: "application/octet-stream" })
    );
    // Stubbed: jsdom treats a real anchor click as a navigation it can't do.
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    renderWithProviders(<Inbox />);
    await openRow(user);
    await user.click(
      await screen.findByRole("button", { name: /books\.xlsx/ })
    );

    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    click.mockRestore();
  });

  it("surfaces a failure instead of failing silently", async () => {
    const user = userEvent.setup();
    setup([withAttachment()]);
    mockedApi.downloadInboundAttachment.mockRejectedValue(new Error("nope"));

    renderWithProviders(<Inbox />);
    await openRow(user);
    await user.click(await screen.findByRole("button", { name: /report\.pdf/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Couldn't open that file.");
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
    renderWithProviders(<Inbox />);

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
    renderWithProviders(<Inbox />);

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
    renderWithProviders(<Inbox />);

    await user.click(await findRow());

    expect(mockedApi.markInboundMessageRead).not.toHaveBeenCalled();
  });
});

describe("Inbox empty state", () => {
  it("renders without messages", async () => {
    setup([]);
    renderWithProviders(<Inbox />);

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
    renderWithProviders(<Inbox />);
    await openRow(user);

    const box = await screen.findByPlaceholderText(/Reply to Sender/);
    await user.type(box, "Thanks!");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

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
    renderWithProviders(<Inbox />);
    await openRow(user);

    const box = await screen.findByPlaceholderText(/Reply to Sender/);
    await user.type(box, "Hi");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("smtp down"));
  });
});

describe("Inbox filters", () => {
  it("re-queries with a search term", async () => {
    const user = userEvent.setup();
    setup([makeMessage()]);
    renderWithProviders(<Inbox />);
    await findRow();

    await user.type(screen.getByPlaceholderText("Search mail"), "invoice");
    await user.tab();

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
    renderWithProviders(<Inbox />);

    await user.click(
      await screen.findByRole("button", { name: /connect a mailbox/i })
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Sales");
    await user.type(
      within(dialog).getByLabelText("Email address"),
      "sales@acme.test"
    );
    await user.type(
      within(dialog).getByLabelText("Incoming mail server"),
      "imap.acme.test"
    );
    await user.type(
      within(dialog).getByLabelText("Username"),
      "sales@acme.test"
    );
    await user.type(within(dialog).getByLabelText("Password"), "secret");
    await user.click(
      within(dialog).getByRole("button", { name: /^connect mailbox$/i })
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
    renderWithProviders(<Inbox />);

    await user.click(
      await screen.findByLabelText("Disconnect support@acme.test")
    );

    await waitFor(() =>
      expect(mockedApi.deleteInboxAccount).toHaveBeenCalledWith(
        "acc_1",
        "org_1"
      )
    );
  });
});
