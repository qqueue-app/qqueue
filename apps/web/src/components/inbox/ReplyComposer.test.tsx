import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../../test/render.js";
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
