import { useLocation, useNavigate } from "react-router-dom";
import {
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "../test/render.js";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  // Used by actions that report progress before their result.
  loading: vi.fn(),
  message: vi.fn(),
}));
const session = vi.hoisted(() => ({ role: "ADMIN" as "ADMIN" | "MEMBER" }));
vi.mock("sonner", () => ({ toast }));

vi.mock("../lib/api.js", () => ({
  api: {
    touchReplyPresence: vi.fn().mockResolvedValue({
      expiresAt: new Date(Date.now() + 45000).toISOString(),
    }),
    leaveReplyPresence: vi.fn().mockResolvedValue({ left: true }),
    listInboxAccounts: vi.fn(),
    listInboxFolders: vi.fn(),
    recentInboxMoves: vi.fn(),
    getInboxMoveBatch: vi.fn(),
    createInboxMove: vi.fn(),
    checkInboxMoves: vi.fn(),
    markInboundMessageFlagged: vi.fn(),
    getInboxConversation: vi.fn(),
    markInboundMessagesRead: vi.fn(),
    syncInbox: vi.fn(),
    retryInboundContent: vi.fn(),
    listMailSignatures: vi.fn().mockResolvedValue([]),
    listEmailDrafts: vi.fn(),
    getEmailDraft: vi.fn(),
    createEmailDraft: vi.fn(),
    updateEmailDraft: vi.fn(),
    deleteEmailDraft: vi.fn(),
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
    uploadImage: vi.fn(),
    listInboundMessages: vi.fn(),
    markInboundMessageRead: vi.fn(),
    replyToInboundMessage: vi.fn(),
    prepareInboundForward: vi.fn(),
    prepareMailboxDraftCopy: vi.fn(),
    createInboxAccount: vi.fn(),
    deleteInboxAccount: vi.fn(),
    downloadInboundAttachment: vi.fn(),
    downloadAttachment: vi.fn(),
  },
}));

vi.mock("../lib/session-context.js", () => ({
  useSession: () => ({
    currentOrganizationId: "org_1",
    currentOrganization: { role: session.role },
  }),
}));

import { api } from "../lib/api.js";
import { Inbox } from "./Inbox.js";
vi.mock("../components/editor/BodyEditor.js", () => ({
  BodyEditor: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
  }) => (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
    />
  ),
}));

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
    ...overrides,
  };
}

function setup(messages: Record<string, unknown>[]) {
  mockedApi.getInboxConversation.mockResolvedValue({ messages, outgoing: [] });
  mockedApi.listInboxFolders.mockResolvedValue([]);
  mockedApi.recentInboxMoves.mockResolvedValue([]);
  mockedApi.markInboundMessageFlagged.mockResolvedValue({} as never);
  mockedApi.markInboundMessagesRead.mockResolvedValue({
    updated: messages.length,
  });
  mockedApi.listEmailDrafts.mockResolvedValue([]);
  mockedApi.createEmailDraft.mockResolvedValue({ id: "draft_reply" });
  mockedApi.updateEmailDraft.mockImplementation(async (id: string) => ({ id }));
  mockedApi.deleteEmailDraft.mockResolvedValue(undefined);
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
      status: "ACTIVE",
    },
  ]);
  mockedApi.listInboundMessages.mockResolvedValue({ data: messages });
  mockedApi.markInboundMessageRead.mockImplementation(async (id: string) =>
    makeMessage({ id, readAt: "2026-07-02T00:00:00.000Z" })
  );
}

/** The conversation's row in the list. */
async function findRow(subject = /Quarterly numbers/) {
  return screen.findByRole("button", {
    name: (name) => subject.test(name) && !name.startsWith("More actions for"),
  });
}

/**
 * Open the conversation, which is what puts the reader on screen: the inbox
 * lists everything full-width and shows a message only once it is tapped, so
 * nothing is selected on load.
 */
async function openRow(
  user: ReturnType<typeof userEvent.setup>,
  subject = /Quarterly numbers/
) {
  await user.click(await findRow(subject));
  return screen.findByRole("button", { name: /^inbox$/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  session.role = "ADMIN";
  // jsdom implements neither half of the object-URL API, which attachment
  // downloads and inline images both rely on.
  URL.createObjectURL = vi.fn(() => "blob:qqueue/inline-1");
  URL.revokeObjectURL = vi.fn();
});

describe("Inbox mailbox access", () => {
  it("shows failed files and queues an authorized retry without offering a broken download", async () => {
    const user = userEvent.setup();
    setup([
      makeMessage({
        contentImportPending: true,
        attachments: [
          {
            id: "file1",
            filename: "large.zip",
            size: 30_000_000,
            contentType: "application/zip",
            isInline: false,
            storageStatus: "TOO_LARGE",
            storageError: "Ask an administrator to raise the limit.",
          },
        ],
      }),
    ]);
    mockedApi.retryInboundContent.mockResolvedValue({ queued: true });
    renderWithProviders(<Inbox />);
    await openRow(user);
    expect(
      await screen.findByText(
        "large.zip: Ask an administrator to raise the limit."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /large.zip/ })).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Retry loading attachments" })
    );
    await waitFor(() =>
      expect(mockedApi.retryInboundContent).toHaveBeenCalledWith("m1", "org_1")
    );
  });
  it("directs a member without a mailbox to their administrator", async () => {
    session.role = "MEMBER";
    mockedApi.listInboxAccounts.mockResolvedValue([]);
    mockedApi.listInboundMessages.mockResolvedValue({ data: [] });
    renderWithProviders(<Inbox />);

    expect(
      await screen.findByText("No mailbox assigned yet")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Ask an administrator to assign you a mailbox.")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /connect a mailbox/i })
    ).not.toBeInTheDocument();
  });

  it("hides mailbox administration from members who can read mail", async () => {
    session.role = "MEMBER";
    setup([makeMessage()]);
    renderWithProviders(<Inbox />);

    await findRow();
    expect(
      screen.queryByRole("button", { name: /connect a mailbox/i })
    ).not.toBeInTheDocument();
  });
});

describe("Inbox single-screen navigation", () => {
  // The list used to sit in a 22rem rail beside a permanently-open reader, and
  // the first conversation was auto-selected — so the inbox marked a message
  // read before anyone touched it.
  it("shows only the list until a conversation is tapped", async () => {
    setup([makeMessage({ readAt: null })]);
    renderWithProviders(<Inbox />);

    await findRow();
    expect(
      screen.queryByRole("button", { name: /^reply$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/Reply to Sender/)
    ).not.toBeInTheDocument();
    expect(mockedApi.markInboundMessageRead).not.toHaveBeenCalled();
  });

  it("labels an unattributed delivery failure in the list and reader", async () => {
    const user = userEvent.setup();
    setup([
      makeMessage({
        subject: "Undelivered Mail Returned to Sender",
        isDsn: true,
        dsnAttribution: "UNATTRIBUTED",
      }),
    ]);
    renderWithProviders(<Inbox />);

    expect(await screen.findByText("Unattributed")).toBeInTheDocument();
    await openRow(user, /Undelivered Mail Returned to Sender/);
    expect(screen.getByText("Unattributed bounce")).toBeInTheDocument();
  });

  it("opens the conversation full-width and comes back to the list", async () => {
    const user = userEvent.setup();
    setup([makeMessage({ readAt: "2026-07-01T12:00:00.000Z" })]);
    renderWithProviders(<Inbox />);

    const back = await openRow(user);
    // The reader replaces the list rather than sitting beside it.
    expect(
      screen.queryByPlaceholderText("Search mail")
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reply", exact: true })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reply all" })).not.toBeInTheDocument();

    await user.click(back);
    expect(
      await screen.findByPlaceholderText("Search mail")
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/Reply to Sender/)
    ).not.toBeInTheDocument();
  });

  it("offers Reply all on a group message and opens it with the group selected", async () => {
    const user = userEvent.setup();
    setup([makeMessage({ to: ["support@acme.test", "teammate@example.com"], cc: ["copy@example.com"] })]);
    renderWithProviders(<Inbox />);
    await openRow(user);
    await user.click(screen.getByRole("button", { name: "Reply all" }));
    expect(await screen.findByRole("group", { name: "Reply recipients" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reply all" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Remove teammate@example.com" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove copy@example.com" })).toBeInTheDocument();
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
        read: false,
      })
    );
    // Staying in the reader would re-mark it read the moment it was reopened.
    expect(
      await screen.findByPlaceholderText("Search mail")
    ).toBeInTheDocument();
  });
});

describe("Inbox read/unread emphasis", () => {
  // The reported bug: every row rendered bold, so "unread" carried no signal.
  it("bolds an unread conversation's sender and subject", async () => {
    setup([makeMessage({ readAt: null })]);
    renderWithProviders(<Inbox />);

    const row = await findRow();
    expect(within(row).getByText("Quarterly numbers").className).toContain(
      "font-semibold"
    );
    expect(within(row).getByText("Sender").className).toContain(
      "font-semibold"
    );
  });

  it("does not bold a conversation that has been read", async () => {
    setup([makeMessage({ readAt: "2026-07-01T12:00:00.000Z" })]);
    renderWithProviders(<Inbox />);

    const row = await findRow();
    const subject = within(row).getByText("Quarterly numbers");
    // A read row drops the bold and dims rather than switching to an explicit
    // font-normal class.
    expect(subject.className).not.toContain("font-semibold");
    expect(within(row).getByText("Sender").className).not.toContain(
      "font-semibold"
    );
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
        text: "Q1 42",
      }),
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
    expect(screen.getAllByText("plain text fallback").length).toBeGreaterThan(
      0
    );
  });

  it("loads remote images without an opt-in", async () => {
    setup([
      makeMessage({ html: '<img src="https://tracker.test/pixel.gif">' }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<Inbox />);
    await openRow(user);

    const frame = await screen.findByTitle(/^Message from/);
    // Reading the mail is enough: img-src admits remote hosts and the src
    // survives into the body, so the image renders on open.
    expect(frame.getAttribute("srcdoc")).toContain(
      "img-src data: blob: https:"
    );
    expect(frame.getAttribute("srcdoc")).toContain("tracker.test");
    // No blocked-images prompt stands between the reader and the message.
    expect(
      screen.queryByRole("button", { name: /show images/i })
    ).not.toBeInTheDocument();
  });

  it("still refuses scripts and network fetches from a message body", async () => {
    setup([
      makeMessage({
        html: '<script>alert(1)</script><img src="https://tracker.test/p.gif">',
      }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<Inbox />);
    await openRow(user);

    // Widening img-src must not widen anything else: the frame stays
    // script-less and default-src stays shut.
    const frame = await screen.findByTitle(/^Message from/);
    const srcdoc = frame.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("default-src 'none'");
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    );
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
            contentId: "<logo@corp>",
          },
        ],
      }),
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
      ).toContain('src="blob:')
    );
    expect(mockedApi.downloadInboundAttachment).toHaveBeenCalledWith({
      messageId: "m1",
      attachmentId: "att_1",
      organizationId: "org_1",
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
          isInline: false,
        },
      ],
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
            isInline: true,
          },
        ],
      }),
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
    await user.click(
      await screen.findByRole("button", { name: /report\.pdf/ })
    );

    await waitFor(() => {
      expect(mockedApi.downloadInboundAttachment).toHaveBeenCalledWith({
        messageId: "m1",
        attachmentId: "att_1",
        organizationId: "org_1",
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
            isInline: false,
          },
        ],
      }),
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
    await user.click(
      await screen.findByRole("button", { name: /report\.pdf/ })
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("nope");
    });
  });
});

describe("Inbox list preview", () => {
  it("derives a snippet from HTML instead of showing a placeholder", async () => {
    setup([
      makeMessage({
        text: null,
        html: "<style>p{color:red}</style><p>Real preview text</p>",
      }),
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
      expect(mockedApi.markInboundMessagesRead).toHaveBeenCalledWith(
        "org_1",
        ["m1"],
        true
      );
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
  it("resumes a message-specific draft from Drafts and does not reopen it after sending", async () => {
    const user = userEvent.setup();
    const message = makeMessage({ readAt: "2026-07-01T12:00:00Z" });
    setup([message]);
    mockedApi.getEmailDraft.mockResolvedValue({
      id: "saved_reply",
      html: "My unfinished reply",
      attachments: [],
    });
    mockedApi.replyToInboundMessage.mockResolvedValue({
      id: "queued_reply",
      status: "QUEUED",
    });
    const rendered = renderWithProviders(<Inbox />, {
      route: "/inbox?message=m1&replyDraft=saved_reply",
    });
    const editor = await screen.findByRole("textbox", {
      name: "Reply to Sender",
    });
    await waitFor(() => expect(editor).toHaveValue("My unfinished reply"));
    expect(mockedApi.getEmailDraft).toHaveBeenCalledWith("saved_reply");
    await user.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Reply to Sender" })
      ).not.toBeInTheDocument()
    );
    mockedApi.getInboxConversation.mockResolvedValue({
      messages: [{ ...message, text: "Updated conversation" }],
      outgoing: [],
    });
    await rendered.queryClient.invalidateQueries({
      queryKey: ["inbox-conversation"],
    });
    expect(
      screen.queryByRole("textbox", { name: "Reply to Sender" })
    ).not.toBeInTheDocument();
  });
  it("replies to the selected older message and includes outgoing history", async () => {
    const user = userEvent.setup();
    const older = makeMessage({
      id: "older",
      messageId: "<older>",
      fromName: "Earlier sender",
      references: ["<root>"],
      readAt: "2026-07-01T12:00:00Z",
    });
    const latest = makeMessage({
      id: "latest",
      references: ["<root>"],
      readAt: "2026-07-01T12:00:00Z",
    });
    setup([latest]);
    mockedApi.getInboxConversation.mockResolvedValue({
      messages: [older, latest],
      outgoing: [
        {
          id: "outgoing",
          sentByName: "Jane",
          subject: "Re: Quarterly numbers",
          html: null,
          text: "Our previous answer",
          toEmail: "sender@example.com",
          cc: [],
          status: "SENT",
          createdAt: "2026-07-01T11:00:00Z",
          sentAt: "2026-07-01T11:00:00Z",
          smtpConnection: { fromEmail: "support@acme.test" },
          attachments: [
            {
              id: "sent_file",
              filename: "sent-report.pdf",
              size: 2000,
              contentType: "application/pdf",
              isInline: false,
            },
          ],
        },
      ],
    });
    renderWithProviders(<Inbox />);
    await openRow(user);
    expect(await screen.findByText("Our previous answer")).toBeInTheDocument();
    mockedApi.downloadAttachment.mockResolvedValue(
      new Blob(["pdf"], { type: "application/pdf" })
    );
    await user.click(screen.getByRole("button", { name: /sent-report.pdf/ }));
    await screen.findByRole("dialog", { name: /sent-report.pdf/ });
    expect(mockedApi.downloadAttachment).toHaveBeenCalledWith("sent_file");
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", {
        name: "Reply to this message from Earlier sender",
      })
    );
    await user.type(
      screen.getByRole("textbox", { name: "Reply to Earlier sender" }),
      "Answer to the older message"
    );
    await user.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() =>
      expect(mockedApi.replyToInboundMessage).toHaveBeenCalledWith(
        "older",
        expect.objectContaining({ html: "Answer to the older message" })
      )
    );
  });
  it("sends a reply through the reply form", async () => {
    const user = userEvent.setup();
    setup([makeMessage({ readAt: "2026-07-01T12:00:00.000Z" })]);
    mockedApi.replyToInboundMessage.mockResolvedValue({
      id: "job_1",
      status: "QUEUED",
    });
    renderWithProviders(<Inbox />);
    await openRow(user);

    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    const box = await screen.findByRole("textbox", { name: "Reply to Sender" });
    await user.type(box, "Thanks!");
    await user.click(screen.getByRole("button", { name: /^send reply$/i }));

    await waitFor(() => {
      expect(mockedApi.replyToInboundMessage).toHaveBeenCalledWith(
        "m1",
        expect.objectContaining({
          organizationId: "org_1",
          html: "Thanks!",
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

    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    const box = await screen.findByRole("textbox", { name: "Reply to Sender" });
    await user.type(box, "Hi");
    await user.click(screen.getByRole("button", { name: /^send reply$/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("smtp down"));
  });
});

describe("Inbox bulk actions and history", () => {
  it("marks selected messages read without opening them", async () => {
    const user = userEvent.setup();
    setup([
      makeMessage(),
      makeMessage({ id: "m2", messageId: "<m2>", subject: "Another message" }),
    ]);
    renderWithProviders(<Inbox />);
    await findRow();
    await user.click(
      screen.getByRole("checkbox", { name: "Select all rows on this page" })
    );
    await user.click(
      screen.getByRole("button", { name: "Mark selected as read" })
    );
    await waitFor(() =>
      expect(mockedApi.markInboundMessagesRead).toHaveBeenCalledWith(
        "org_1",
        ["m1", "m2"],
        true
      )
    );
    expect(mockedApi.getInboxConversation).not.toHaveBeenCalled();
  });

  it("loads older mail using the server cursor", async () => {
    const user = userEvent.setup();
    setup([makeMessage()]);
    mockedApi.listInboundMessages.mockImplementation(
      async (input: { cursor?: string }) =>
        input.cursor
          ? {
              data: [
                makeMessage({
                  id: "older",
                  messageId: "<older>",
                  subject: "Older mail",
                }),
              ],
            }
          : { data: [makeMessage()], nextCursor: "m1" }
    );
    renderWithProviders(<Inbox />);
    await user.click(
      await screen.findByRole("button", { name: "Load older mail" })
    );
    expect(await findRow(/Older mail/)).toBeInTheDocument();
    expect(mockedApi.listInboundMessages).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "m1" })
    );
  });

  it("requests an actual mailbox sync", async () => {
    mockedApi.syncInbox.mockResolvedValue({ queued: 1 });
    const user = userEvent.setup();
    setup([]);
    renderWithProviders(<Inbox />);
    await user.click(
      await screen.findByRole("button", { name: "Check for new mail" })
    );
    await waitFor(() =>
      expect(mockedApi.syncInbox).toHaveBeenCalledWith("org_1", undefined)
    );
  });

  it("distinguishes a loading failure from an empty mailbox", async () => {
    setup([]);
    mockedApi.listInboundMessages.mockRejectedValue(new Error("unreachable"));
    renderWithProviders(<Inbox />);
    expect(
      await screen.findByText("Couldn't load your mail")
    ).toBeInTheDocument();
    expect(screen.queryByText("No conversations yet")).not.toBeInTheDocument();
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
          host: "imap.acme.test",
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

    await user.click(
      screen.getByRole("button", { name: "Disconnect mailbox" })
    );
    await waitFor(() =>
      expect(mockedApi.deleteInboxAccount).toHaveBeenCalledWith(
        "acc_1",
        "org_1"
      )
    );
  });
});

function HistoryControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button onClick={() => navigate(-1)}>Browser history back</button>
      <output aria-label="Current URL">{location.search}</output>
    </>
  );
}
describe("mail folder navigation and shared flags", () => {
  it("restores URL-owned mailbox, folder, search and read filters through browser history", async () => {
    setup([makeMessage()]);
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <Inbox />
        <HistoryControls />
      </>,
      { route: "/inbox?view=ARCHIVE&mailbox=acc_1&q=invoice&read=unread" }
    );
    await findRow();
    expect(
      screen.getByRole("heading", { name: "Archive" })
    ).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search mail" })).toHaveValue(
      "invoice"
    );
    expect(mockedApi.listInboundMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        view: "ARCHIVE",
        inboxAccountId: "acc_1",
        q: "invoice",
        read: "unread",
      })
    );
    await user.click(screen.getByRole("button", { name: /^read$/i }));
    await waitFor(() =>
      expect(screen.getByLabelText("Current URL")).toHaveTextContent(
        "read=read"
      )
    );
    await user.click(
      screen.getByRole("button", { name: "Browser history back" })
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^unread$/i })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    );
    expect(screen.getByRole("searchbox", { name: "Search mail" })).toHaveValue(
      "invoice"
    );
  });
  it("requests the chosen folder without marking any message read", async () => {
    setup([]);
    const user = userEvent.setup();
    renderWithProviders(<Inbox />);
    await user.click(
      screen.getByRole("combobox", { name: "Choose mail folder" })
    );
    await user.click(
      screen.getByRole("option", { name: "Trash", exact: true })
    );
    await waitFor(() =>
      expect(mockedApi.listInboundMessages).toHaveBeenCalledWith(
        expect.objectContaining({ view: "TRASH" })
      )
    );
    expect(mockedApi.markInboundMessageRead).not.toHaveBeenCalled();
  });
  it("offers retry when folder discovery cannot load", async () => {
    setup([]);
    mockedApi.listInboxFolders.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    renderWithProviders(<Inbox />);
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(mockedApi.listInboxFolders).toHaveBeenCalledTimes(2)
    );
  });
  it("flags the selected logical message and shows pending mailbox writeback", async () => {
    setup([
      makeMessage({ flagPending: true, flagSyncError: "Mailbox is offline" }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<Inbox />);
    await openRow(user);
    expect(screen.getByText("Mailbox is offline")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Flag message", exact: true })
    );
    await waitFor(() =>
      expect(mockedApi.markInboundMessageFlagged).toHaveBeenCalledWith(
        "m1",
        "org_1",
        true
      )
    );
  });
  it("removes a shared flag from the selected message", async () => {
    setup([makeMessage({ flagged: true })]);
    const user = userEvent.setup();
    renderWithProviders(<Inbox />);
    await openRow(user);
    await user.click(
      screen.getByRole("button", { name: "Remove flag", exact: true })
    );
    await waitFor(() =>
      expect(mockedApi.markInboundMessageFlagged).toHaveBeenCalledWith(
        "m1",
        "org_1",
        false
      )
    );
  });
});

describe("forwarding from a conversation", () => {
  it("prepares the chosen original message once and navigates to its draft", async () => {
    const user = userEvent.setup();
    setup([makeMessage()]);
    mockedApi.prepareInboundForward.mockResolvedValue({ id: "forward_draft" });
    renderWithProviders(
      <>
        <Inbox />
        <HistoryControls />
      </>
    );
    await openRow(user);
    await user.click(
      screen.getByRole("button", { name: "Forward this message from Sender" })
    );
    await waitFor(() =>
      expect(mockedApi.prepareInboundForward).toHaveBeenCalledWith(
        "m1",
        "org_1",
        expect.any(String)
      )
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Current URL")).toHaveTextContent(
        "draft=forward_draft"
      )
    );
  });
  it("retains the preparation identity after a lost response", async () => {
    const user = userEvent.setup();
    setup([makeMessage()]);
    mockedApi.prepareInboundForward
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue({ id: "forward_draft" });
    renderWithProviders(<Inbox />);
    await openRow(user);
    await user.click(
      screen.getByRole("button", { name: "Forward this message from Sender" })
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("response lost")
    );
    await user.click(
      screen.getByRole("button", { name: "Forward this message from Sender" })
    );
    await waitFor(() =>
      expect(mockedApi.prepareInboundForward).toHaveBeenCalledTimes(2)
    );
    expect(mockedApi.prepareInboundForward.mock.calls[0][2]).toBe(
      mockedApi.prepareInboundForward.mock.calls[1][2]
    );
  });
});

it("retries a deep-linked embedded conversation without fetching an unrelated inbox page", async () => {
  setup([makeMessage()]);
  mockedApi.getInboxConversation
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ messages: [makeMessage()], outgoing: [] });
  const user = userEvent.setup();
  renderWithProviders(<Inbox embedded backLabel="Search mail" />, {
    route: "/search?message=m1",
  });
  await user.click(
    await screen.findByRole("button", { name: "Try opening again" })
  );
  expect(
    await screen.findByRole("heading", { name: "Quarterly numbers" })
  ).toBeInTheDocument();
  expect(mockedApi.listInboundMessages).not.toHaveBeenCalled();
});

it("pages ten rendered bodies while marking all conversation members read once and restoring its page through Back", async () => {
  const rows = Array.from({ length: 25 }, (_, index) =>
    makeMessage({
      id: `m${index + 1}`,
      messageId: `<m${index + 1}>`,
      references: ["<root>"],
      receivedAt: new Date(2026, 0, 1, 0, index).toISOString(),
      readAt: null,
    })
  );
  setup(rows);
  mockedApi.getInboxConversation.mockImplementation(
    async (
      _id: string,
      _org: string,
      page: { before?: string; after?: string } = {}
    ) => {
      const earlier = Boolean(page.before);
      const visible = rows
        .slice(earlier ? 5 : 15, earlier ? 15 : 25)
        .map((row) => `received:${row.id}`);
      return {
        messages: rows.map((row, index) => ({
          ...row,
          bodyLoaded: visible.includes(`received:${row.id}`),
          html: visible.includes(`received:${row.id}`)
            ? `<p>Body ${index + 1}</p>`
            : null,
          text: null,
          attachments: [],
        })),
        outgoing: [],
        window: {
          keys: visible,
          before: earlier ? "received:m6" : "received:m16",
          after: earlier ? "received:m15" : null,
          total: 25,
          start: earlier ? 6 : 16,
          end: earlier ? 15 : 25,
        },
      };
    }
  );
  const user = userEvent.setup();
  renderWithProviders(
    <>
      <Inbox embedded />
      <HistoryControls />
    </>,
    { route: "/search?message=m25" }
  );
  await screen.findByText("Messages 16–25 of 25");
  expect(screen.getAllByTitle(/^Message from/)).toHaveLength(10);
  expect(mockedApi.markInboundMessagesRead).toHaveBeenCalledWith(
    "org_1",
    rows.map((row) => row.id),
    true
  );
  expect(mockedApi.markInboundMessageRead).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Earlier messages" }));
  await screen.findByText("Messages 6–15 of 25");
  expect(screen.getAllByTitle(/^Message from/)).toHaveLength(10);
  expect(screen.getByLabelText("Current URL")).toHaveTextContent(
    "beforeMessage=received%3Am16"
  );
  expect(mockedApi.getInboxConversation).toHaveBeenCalledWith(
    "m25",
    "org_1",
    expect.objectContaining({ before: "received:m16" })
  );
  await user.click(
    screen.getByRole("button", { name: "Browser history back" })
  );
  await screen.findByText("Messages 16–25 of 25");
  expect(screen.getAllByTitle(/^Message from/)).toHaveLength(10);
});

it("continues an imported mailbox draft as a private copy and never replies to itself", async () => {
  const user = userEvent.setup();
  const draft = makeMessage({
    remoteDraftVersion: "a".repeat(64),
    locations: [
      {
        id: "l1",
        inboxFolderId: "folder1",
        folder: { path: "Drafts", name: "Drafts", role: "DRAFTS" },
      },
    ],
  });
  setup([draft]);
  mockedApi.prepareMailboxDraftCopy.mockResolvedValue({ id: "private1" });
  renderWithProviders(<Inbox />, { route: "/inbox?message=m1" });
  const continueButton = await screen.findByRole("button", {
    name: "Continue as private copy",
  });
  expect(
    screen.getByRole("button", { name: "Reply to this message from Sender" })
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reply", exact: true })).toBeDisabled();
  await user.click(continueButton);
  await waitFor(() =>
    expect(mockedApi.prepareMailboxDraftCopy).toHaveBeenCalledWith(
      "m1",
      "org_1",
      expect.any(String),
      "a".repeat(64)
    )
  );
  expect(mockedApi.replyToInboundMessage).not.toHaveBeenCalled();
});
