import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../../test/render.js";
import { installFakeIndexedDB } from "../../test/fake-indexeddb.js";
import { listPendingDrafts } from "../../lib/offline-drafts.js";
import { ReplyComposer } from "./ReplyComposer.js";
import { api, type InboundMessage } from "../../lib/api.js";

vi.mock("../../lib/session-context.js", () => ({
  useSession: () => ({ user: { id: "user_1" } }),
}));
vi.mock("../editor/BodyEditor.js", () => ({
  BodyEditor: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (html: string) => void;
    ariaLabel: string;
  }) => (
    <textarea
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("../../lib/api.js", () => ({
  api: {
    listMailSignatures: vi.fn().mockResolvedValue([]),
    listEmailDrafts: vi.fn(),
    getEmailDraft: vi.fn(),
    createEmailDraft: vi.fn(),
    updateEmailDraft: vi.fn(),
    replyToInboundMessage: vi.fn(),
    deleteEmailDraft: vi.fn(),
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const message = {
  id: "message_1",
  organizationId: "org_1",
  inboxAccountId: "inbox_1",
  messageId: "<one>",
  references: [],
  fromEmail: "customer@example.com",
  fromName: "Customer",
  replyTo: ["answers@example.com"],
  to: ["support@example.com", "other@example.com"],
  cc: ["copy@example.com"],
  subject: "Question",
  receivedAt: "2026-10-14T12:00:00Z",
} as InboundMessage;
const queued = vi.fn();
const close = vi.fn();
const storageKey = "qqueue.reply.user_1.org_1.message_1";

function renderReply() {
  return renderWithProviders(
    <ReplyComposer
      message={message}
      organizationId="org_1"
      mailboxEmail="support@example.com"
      onQueued={queued}
      onClose={close}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem(
    "qqueue.session",
    JSON.stringify({ user: { id: "user_1" }, organizations: [] })
  );
  mocked.listEmailDrafts.mockResolvedValue([]);
  mocked.createEmailDraft.mockResolvedValue({ id: "draft_1" } as never);
  mocked.updateEmailDraft.mockResolvedValue({ id: "draft_1" } as never);
  mocked.replyToInboundMessage.mockResolvedValue({
    id: "job_1",
    status: "QUEUED",
  });
  mocked.deleteEmailDraft.mockResolvedValue(undefined);
  mocked.deleteAttachment.mockResolvedValue(undefined);
});

describe("reply composer", () => {
  it("shows the actual mailbox, Reply-To recipient and an immediately accessible rich editor", async () => {
    renderReply();
    expect(screen.getByText("support@example.com")).toBeInTheDocument();
    expect(screen.getByText("answers@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Reply to Customer" })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mocked.listEmailDrafts).toHaveBeenCalledWith("org_1")
    );
    expect(screen.getByRole("button", { name: "Send reply" })).toBeDisabled();
  });

  it("submits the chosen message with HTML and a retry key, then reports queued", async () => {
    const user = userEvent.setup();
    renderReply();
    await user.type(
      screen.getByRole("textbox", { name: "Reply to Customer" }),
      "<p>Hello</p>"
    );
    await user.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(queued).toHaveBeenCalledWith("job_1"));
    expect(mocked.replyToInboundMessage).toHaveBeenCalledWith(
      "message_1",
      expect.objectContaining({
        html: "<p>Hello</p>",
        idempotencyKey: expect.any(String),
        replyAll: false,
      })
    );
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("keeps the text on failure and uses the same key on retry", async () => {
    mocked.replyToInboundMessage.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    renderReply();
    const editor = screen.getByRole("textbox", { name: "Reply to Customer" });
    await user.type(editor, "Keep my answer");
    await user.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() =>
      expect(mocked.replyToInboundMessage).toHaveBeenCalledTimes(1)
    );
    expect(editor).toHaveValue("Keep my answer");
    expect(queued).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(queued).toHaveBeenCalled());
    expect(mocked.replyToInboundMessage.mock.calls[0][1].idempotencyKey).toBe(
      mocked.replyToInboundMessage.mock.calls[1][1].idempotencyKey
    );
  });

  it("restores a server reply draft including attachments", async () => {
    mocked.listEmailDrafts.mockResolvedValue([
      { id: "draft_1", inboundMessageId: "message_1" },
    ] as never);
    mocked.getEmailDraft.mockResolvedValue({
      id: "draft_1",
      html: "Already started",
      attachments: [{ id: "file_1", filename: "report.pdf", size: 2000 }],
    } as never);
    renderReply();
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Reply to Customer" })
      ).toHaveValue("Already started")
    );
    expect(screen.getByText(/report.pdf/)).toBeInTheDocument();
  });

  it("saves and links uploaded attachments before sending", async () => {
    mocked.uploadAttachment.mockResolvedValue({
      id: "file_1",
      filename: "report.pdf",
      size: 2000,
    } as never);
    const user = userEvent.setup();
    renderReply();
    await user.type(
      screen.getByRole("textbox", { name: "Reply to Customer" }),
      "Attached"
    );
    await user.upload(
      screen.getByLabelText("Attach files to reply"),
      new File(["pdf"], "report.pdf", { type: "application/pdf" })
    );
    expect(await screen.findByText(/report.pdf/)).toBeInTheDocument();
    expect(mocked.uploadAttachment).toHaveBeenCalledWith(expect.any(File), {
      organizationId: "org_1",
      emailDraftId: "draft_1",
      uploadId: expect.any(String),
    });
    await user.click(
      screen.getByRole("checkbox", { name: "Reply to everyone" })
    );
    await user.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() =>
      expect(mocked.replyToInboundMessage).toHaveBeenCalledWith(
        "message_1",
        expect.objectContaining({ attachmentIds: ["file_1"], replyAll: true })
      )
    );
    expect(mocked.deleteEmailDraft).not.toHaveBeenCalled();
  });

  it("does not let a reply leave while a file is uploading", async () => {
    let finish!: (value: never) => void;
    mocked.uploadAttachment.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const user = userEvent.setup();
    renderReply();
    await user.type(
      screen.getByRole("textbox", { name: "Reply to Customer" }),
      "Attached"
    );
    await user.upload(
      screen.getByLabelText("Attach files to reply"),
      new File(["pdf"], "report.pdf")
    );
    await waitFor(() => expect(mocked.uploadAttachment).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Send reply" })).toBeDisabled();
    finish({ id: "file_1", filename: "report.pdf", size: 3 } as never);
    await screen.findByText(/report.pdf/);
  });

  it("keeps a draft when closing and restores its local backup", async () => {
    const user = userEvent.setup();
    const rendered = renderReply();
    await user.type(
      screen.getByRole("textbox", { name: "Reply to Customer" }),
      "Unfinished"
    );
    await user.click(
      screen.getByRole("button", { name: "Close and keep draft" })
    );
    await waitFor(() =>
      expect(mocked.createEmailDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          inboundMessageId: "message_1",
          html: "Unfinished",
        })
      )
    );
    expect(close).toHaveBeenCalled();
    rendered.unmount();
    renderReply();
    expect(
      screen.getByRole("textbox", { name: "Reply to Customer" })
    ).toHaveValue("Unfinished");
  });

  it("removes a reply attachment deliberately", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        html: "Hello",
        replyAll: false,
        attachments: [{ id: "file_1", filename: "report.pdf", size: 3 }],
      })
    );
    const user = userEvent.setup();
    renderReply();
    await user.click(screen.getByRole("button", { name: "Remove report.pdf" }));
    await waitFor(() =>
      expect(screen.queryByText(/report.pdf/)).not.toBeInTheDocument()
    );
    expect(mocked.deleteAttachment).toHaveBeenCalledWith("file_1");
  });
});

describe("reply recovery and recipients", () => {
  it("sends the edited To, Cc and Bcc recipients rather than rebuilding Reply all", async () => {
    const user = userEvent.setup();
    renderReply();
    await user.click(
      screen.getByRole("checkbox", { name: "Reply to everyone" })
    );
    await user.click(
      screen.getByRole("button", { name: "Remove other@example.com" })
    );
    await user.type(
      screen.getByRole("combobox", { name: "Bcc" }),
      "private@example.com{Enter}"
    );
    await user.type(
      screen.getByRole("textbox", { name: "Reply to Customer" }),
      "My reply"
    );
    await user.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(queued).toHaveBeenCalled());
    expect(mocked.replyToInboundMessage).toHaveBeenCalledWith(
      "message_1",
      expect.objectContaining({
        to: ["answers@example.com"],
        cc: ["copy@example.com"],
        bcc: ["private@example.com"],
      })
    );
  });
  it("recovers the accepted delivery identity after losing the send response", async () => {
    mocked.replyToInboundMessage.mockRejectedValueOnce(
      new Error("response lost")
    );
    mocked.getEmailDraft.mockResolvedValue({
      id: "draft_1",
      completedSendId: "accepted_1",
    } as never);
    const user = userEvent.setup();
    renderReply();
    await user.type(
      screen.getByRole("textbox", { name: "Reply to Customer" }),
      "Once only"
    );
    await user.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(queued).toHaveBeenCalledWith("accepted_1"));
    expect(mocked.replyToInboundMessage).toHaveBeenCalledOnce();
  });
  it("keeps a failed file visible, blocks sending and reuses the upload identity", async () => {
    mocked.uploadAttachment
      .mockRejectedValueOnce(new Error("Network interrupted"))
      .mockResolvedValue({
        id: "file_1",
        filename: "retry.pdf",
        size: 3,
      } as never);
    const user = userEvent.setup();
    renderReply();
    await user.type(
      screen.getByRole("textbox", { name: "Reply to Customer" }),
      "File attached"
    );
    await user.upload(
      screen.getByLabelText("Attach files to reply"),
      new File(["pdf"], "retry.pdf")
    );
    expect(
      await screen.findByText(/retry.pdf: Network interrupted/)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send reply" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Retry retry.pdf" }));
    await waitFor(() =>
      expect(mocked.uploadAttachment).toHaveBeenCalledTimes(2)
    );
    expect(mocked.uploadAttachment.mock.calls[0][1]?.uploadId).toBe(
      mocked.uploadAttachment.mock.calls[1][1]?.uploadId
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send reply" })).toBeEnabled()
    );
  });
  it("does not adopt a newer server revision over locally recovered writing", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        html: "My version",
        draftId: "draft_1",
        revision: 2,
        attachments: [],
      })
    );
    mocked.getEmailDraft.mockResolvedValue({
      id: "draft_1",
      organizationId: "org_1",
      revision: 3,
      html: "Teammate version",
      to: ["answers@example.com"],
    } as never);
    renderReply();
    expect(
      await screen.findByText(/This draft changed on another device/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Reply to Customer" })
    ).toHaveValue("My version");
    expect(mocked.updateEmailDraft).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Compare saved version" })
    );
    expect(await screen.findByTitle("Saved draft version")).toHaveAttribute(
      "srcdoc",
      "Teammate version"
    );
    expect(
      screen.getByRole("textbox", { name: "Reply to Customer" })
    ).toHaveValue("My version");
  });
});

it("restores legacy Reply all drafts without silently dropping original To and Cc recipients", async () => {
  mocked.listEmailDrafts.mockResolvedValue([
    { id: "draft_1", inboundMessageId: "message_1" },
  ] as never);
  mocked.getEmailDraft.mockResolvedValue({
    id: "draft_1",
    revision: 1,
    html: "Older reply",
    to: ["answers@example.com"],
    cc: [],
    variables: { qqueueReplyAll: true },
  } as never);
  renderReply();
  expect(
    await screen.findByRole("button", { name: "Remove other@example.com" })
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Remove copy@example.com" })
  ).toBeInTheDocument();
});
it("does not add a recipient back into a saved Cc-only reply", async () => {
  mocked.listEmailDrafts.mockResolvedValue([
    { id: "draft_1", inboundMessageId: "message_1" },
  ] as never);
  mocked.getEmailDraft.mockResolvedValue({
    id: "draft_1",
    revision: 1,
    html: "Cc-only reply",
    to: [],
    cc: ["copy@example.com"],
    variables: { qqueueEditableRecipients: true },
  } as never);
  renderReply();
  await screen.findByRole("button", { name: "Remove copy@example.com" });
  expect(
    screen.queryByRole("button", { name: "Remove answers@example.com" })
  ).not.toBeInTheDocument();
});
it("restores the bytes and retry identity of a failed file after the reply is reopened", async () => {
  const db = installFakeIndexedDB();
  try {
    mocked.uploadAttachment
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        id: "file_1",
        filename: "reopen.txt",
        size: 4,
      } as never);
    mocked.getEmailDraft.mockResolvedValue({
      id: "draft_1",
      revision: 1,
      html: "Keep my file",
      to: ["answers@example.com"],
      attachments: [],
    } as never);
    const user = userEvent.setup();
    const first = renderReply();
    await user.type(
      screen.getByRole("textbox", { name: "Reply to Customer" }),
      "Keep my file"
    );
    await user.upload(
      screen.getByLabelText("Attach files to reply"),
      new File(["keep"], "reopen.txt")
    );
    await screen.findByRole("button", { name: "Retry reopen.txt" });
    await waitFor(async () =>
      expect(
        (await listPendingDrafts("org_1"))[0]?.pendingUploads?.[0]?.file.name
      ).toBe("reopen.txt")
    );
    const identity = mocked.uploadAttachment.mock.calls[0][1]?.uploadId;
    first.unmount();
    renderReply();
    await user.click(
      await screen.findByRole("button", { name: "Retry reopen.txt" })
    );
    await waitFor(() =>
      expect(mocked.uploadAttachment).toHaveBeenCalledTimes(2)
    );
    expect(mocked.uploadAttachment.mock.calls[1][1]?.uploadId).toBe(identity);
    expect(mocked.uploadAttachment.mock.calls[1][0].name).toBe("reopen.txt");
  } finally {
    db.restore();
  }
});

it("keeps newer writing beside file bytes when an older upload attempt fails", async () => {
  const db = installFakeIndexedDB();
  try {
    let fail!: (reason: Error) => void;
    mocked.uploadAttachment.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    const user = userEvent.setup();
    renderReply();
    const editor = screen.getByRole("textbox", { name: "Reply to Customer" });
    await user.type(editor, "First version");
    await user.upload(
      screen.getByLabelText("Attach files to reply"),
      new File(["keep"], "writing.txt")
    );
    await waitFor(() => expect(mocked.uploadAttachment).toHaveBeenCalledOnce());
    await user.clear(editor);
    await user.type(editor, "Newer writing while uploading");
    fail(new Error("connection dropped"));
    await screen.findByRole("button", { name: "Retry writing.txt" });
    await waitFor(async () =>
      expect((await listPendingDrafts("org_1"))[0]?.payload.html).toBe(
        "Newer writing while uploading"
      )
    );
  } finally {
    db.restore();
  }
});
