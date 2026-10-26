import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { onlineManager } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { renderWithProviders, screen, waitFor } from "../../test/render.js";
import { installFakeIndexedDB } from "../../test/fake-indexeddb.js";
import { listPendingDrafts } from "../../lib/offline-drafts.js";
import {
  listWindowDrafts,
  forgetWindowDraft,
} from "../../lib/window-drafts.js";
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
    disabled,
  }: {
    value: string;
    onChange: (html: string) => void;
    ariaLabel: string;
    disabled?: boolean;
  }) => (
    <textarea
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("../../lib/api.js", () => ({
  api: {
    touchReplyPresence: vi.fn().mockResolvedValue({
      expiresAt: new Date(Date.now() + 45000).toISOString(),
    }),
    leaveReplyPresence: vi.fn().mockResolvedValue({ left: true }),
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

async function renderReply() {
  const view = renderWithProviders(
    <ReplyComposer
      message={message}
      organizationId="org_1"
      mailboxEmail="support@example.com"
      onQueued={queued}
      onClose={close}
    />
  );
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "Reply to Customer" })
    ).toBeEnabled()
  );
  return view;
}

beforeEach(() => {
  for (const copy of listWindowDrafts("user_1"))
    forgetWindowDraft(copy.localId);
  vi.clearAllMocks();
  for (const method of [
    mocked.listEmailDrafts,
    mocked.getEmailDraft,
    mocked.createEmailDraft,
    mocked.updateEmailDraft,
    mocked.uploadAttachment,
    mocked.replyToInboundMessage,
  ])
    method.mockReset();
  mocked.getEmailDraft.mockResolvedValue({
    id: "draft_1",
    revision: 1,
  } as never);
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
    await renderReply();
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
    await renderReply();
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

  it("sends raw HTML source from a reply unchanged", async () => {
    const user = userEvent.setup();
    await renderReply();
    const source = "<html><body><p>Exact source</p></body></html>";
    await user.type(
      screen.getByRole("textbox", { name: "Reply to Customer" }),
      source
    );
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() =>
      expect(mocked.replyToInboundMessage).toHaveBeenCalledWith(
        "message_1",
        expect.objectContaining({ html: source })
      )
    );
  });

  it("keeps the text on failure and uses the same key on retry", async () => {
    mocked.replyToInboundMessage.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    await renderReply();
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
    await renderReply();
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
    await renderReply();
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
      signal: expect.any(AbortSignal),
    });
    await user.click(
      screen.getByRole("button", { name: "Reply all" })
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
    await renderReply();
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
    const rendered = await renderReply();
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
    await renderReply();
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
    await renderReply();
    await user.click(screen.getByRole("button", { name: "Remove report.pdf" }));
    await waitFor(() =>
      expect(screen.queryByText(/report.pdf/)).not.toBeInTheDocument()
    );
    expect(mocked.deleteAttachment).toHaveBeenCalledWith("file_1");
  });
});

describe("reply recovery and recipients", () => {
  it("switches between Reply and Reply all without losing the draft", async () => {
    const user = userEvent.setup();
    await renderReply();
    const editor = screen.getByRole("textbox", { name: "Reply to Customer" });
    await user.type(editor, "Keep this answer");
    await user.click(screen.getByRole("button", { name: "Reply all" }));
    expect(screen.getByRole("button", { name: "Reply all" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Remove other@example.com" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove copy@example.com" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reply", exact: true }));
    expect(screen.getByRole("button", { name: "Reply", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Remove other@example.com" })).not.toBeInTheDocument();
    expect(editor).toHaveValue("Keep this answer");
  });

  it("sends the edited To, Cc and Bcc recipients rather than rebuilding Reply all", async () => {
    const user = userEvent.setup();
    await renderReply();
    await user.click(
      screen.getByRole("button", { name: "Reply all" })
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
    await renderReply();
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
    await renderReply();
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
    await renderReply();
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
  await renderReply();
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
  await renderReply();
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
    const first = await renderReply();
    await user.type(
      screen.getByRole("textbox", { name: "Reply to Customer" }),
      "Keep my file"
    );
    await user.upload(
      screen.getByLabelText("Attach files to reply"),
      new File(["keep"], "reopen.txt")
    );
    await waitFor(() =>
      expect(mocked.uploadAttachment).toHaveBeenCalledTimes(1)
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry reopen.txt" })
      ).toBeEnabled()
    );
    await waitFor(async () =>
      expect(
        (await listPendingDrafts("org_1"))[0]?.pendingUploads?.[0]?.file.name
      ).toBe("reopen.txt")
    );
    const identity = mocked.uploadAttachment.mock.calls[0][1]?.uploadId;
    first.unmount();
    await renderReply();
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
    await renderReply();
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

it("keeps composing available when best-effort reply presence fails", async () => {
  mocked.touchReplyPresence.mockRejectedValueOnce(
    new Error("coordination unavailable")
  );
  await renderReply();
  expect(
    await screen.findByText(/Replying status is unavailable/)
  ).toBeInTheDocument();
  await userEvent.type(
    screen.getByRole("textbox", { name: "Reply to Customer" }),
    "Unsent writing stays editable"
  );
  expect(screen.getByRole("button", { name: "Send reply" })).toBeEnabled();
  expect(mocked.replyToInboundMessage).not.toHaveBeenCalled();
});

it("keeps two open composers' device writing separate and preserves the replaced copy", async () => {
  const first = await renderReply();
  await userEvent.type(
    screen.getByRole("textbox", { name: "Reply to Customer" }),
    "First tab writing"
  );
  await renderReply();
  const body = screen.getByRole("textbox", { name: "Reply to Customer" });
  await waitFor(() => expect(body).toBeEnabled());
  await userEvent.clear(body);
  await userEvent.type(body, "Second tab writing");
  const deviceWriting = () =>
    Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!)
      .filter((key) => key.startsWith(storageKey))
      .map((key) => JSON.parse(localStorage.getItem(key)!));
  expect(deviceWriting().map((value) => value.html)).toEqual(
    expect.arrayContaining(["First tab writing", "Second tab writing"])
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Review device copies" })
  );
  await userEvent.click(screen.getByRole("button", { name: /Review copy 1/ }));
  await userEvent.click(
    screen.getByRole("button", { name: "Use this device copy" })
  );
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "Reply to Customer" })
    ).toHaveValue("First tab writing")
  );
  expect(deviceWriting().map((value) => value.html)).toEqual(
    expect.arrayContaining(["First tab writing", "Second tab writing"])
  );
  expect(mocked.replyToInboundMessage).not.toHaveBeenCalled();
  first.unmount();
});

it("does not call newer writing saved when an older offline save resumes", async () => {
  let finish!: (value: unknown) => void;
  mocked.createEmailDraft.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never
  );
  const view = await renderReply();
  try {
    const body = screen.getByRole("textbox", { name: "Reply to Customer" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Attach files" })).toBeEnabled()
    );
    act(() => onlineManager.setOnline(false));
    await userEvent.type(body, "Older offline snapshot");
    await screen.findByText(/Waiting for a connection/, {}, { timeout: 3000 });
    await userEvent.clear(body);
    await userEvent.type(body, "Newer unsaved writing");
    act(() => onlineManager.setOnline(true));
    await waitFor(() =>
      expect(mocked.createEmailDraft).toHaveBeenCalledWith(
        expect.objectContaining({ html: "Older offline snapshot" })
      )
    );
    await act(async () => {
      finish({ id: "draft1", revision: 1 });
    });
    expect(body).toHaveValue("Newer unsaved writing");
    expect(screen.queryByText("Draft saved")).not.toBeInTheDocument();
  } finally {
    act(() => onlineManager.setOnline(true));
    view.unmount();
  }
});

it("retains first-attachment bytes and writing across navigation when both device stores fail offline", async () => {
  const user = userEvent.setup();
  const first = await renderReply();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Attach files" })).toBeEnabled()
  );
  const storageFailure = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
  try {
    act(() => window.dispatchEvent(new Event("offline")));
    await user.type(
      screen.getByRole("textbox", { name: "Reply to Customer" }),
      "Window-only reply writing"
    );
    await user.upload(
      screen.getByLabelText("Attach files to reply"),
      new File(["first file bytes"], "first-offline.txt")
    );
    await waitFor(async () =>
      expect((await listPendingDrafts("org_1"))[0]).toMatchObject({
        memoryOnly: true,
        payload: { html: "Window-only reply writing" },
        pendingUploads: [{ uploadId: expect.any(String) }],
      })
    );
    expect(mocked.createEmailDraft).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Close and keep draft" })
    );
    first.unmount();
    await renderReply();
    expect(
      screen.getByRole("textbox", { name: "Reply to Customer" })
    ).toHaveValue("Window-only reply writing");
    const copy = (await listPendingDrafts("org_1"))[0];
    expect(copy.pendingUploads?.[0].file.name).toBe("first-offline.txt");
    expect(copy.pendingUploads?.[0].file.size).toBe(16);
    expect(mocked.replyToInboundMessage).not.toHaveBeenCalled();
  } finally {
    storageFailure.mockRestore();
    act(() => window.dispatchEvent(new Event("online")));
  }
});

it("aborts a departing reply upload and keeps retry bytes under the same upload identity", async () => {
  mocked.uploadAttachment.mockImplementation(() => new Promise(() => {}));
  const view = await renderReply();
  const user = userEvent.setup();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Attach files" })).toBeEnabled()
  );
  await user.type(
    screen.getByRole("textbox", { name: "Reply to Customer" }),
    "Unfinished upload writing"
  );
  await user.upload(
    screen.getByLabelText("Attach files to reply"),
    new File(["keep"], "interrupted.txt")
  );
  await waitFor(() => expect(mocked.uploadAttachment).toHaveBeenCalledTimes(1));
  const options = mocked.uploadAttachment.mock.calls[0][1]!;
  await user.click(
    screen.getByRole("button", { name: "Close and keep draft" })
  );
  expect(options.signal?.aborted).toBe(true);
  view.unmount();
  expect((await listPendingDrafts("org_1"))[0]).toMatchObject({
    payload: { html: "Unfinished upload writing" },
    pendingUploads: [{ uploadId: options.uploadId }],
  });
  expect(mocked.replyToInboundMessage).not.toHaveBeenCalled();
});

it("keeps local reply writing against the reviewed revision and retains the remote uploaded files", async () => {
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      html: "Local reply writing",
      to: ["local@example.com"],
      cc: [],
      bcc: [],
      draftId: "draft_1",
      revision: 1,
    })
  );
  mocked.getEmailDraft.mockResolvedValue({
    id: "draft_1",
    organizationId: "org_1",
    revision: 2,
    html: "Remote reply writing",
    to: ["remote@example.com"],
    attachments: [{ id: "remote-file", filename: "remote.txt" }],
  } as never);
  mocked.updateEmailDraft.mockResolvedValue({
    id: "draft_1",
    revision: 3,
  } as never);
  const user = userEvent.setup();
  await renderReply();
  await user.click(
    await screen.findByRole("button", { name: "Compare saved version" })
  );
  await screen.findByText("Saved version (read only)");
  await user.click(screen.getByRole("button", { name: "Keep my writing" }));
  expect(
    screen.getByRole("textbox", { name: "Reply to Customer" })
  ).toHaveValue("Local reply writing");
  await waitFor(
    () =>
      expect(mocked.updateEmailDraft).toHaveBeenCalledWith(
        "draft_1",
        expect.objectContaining({
          expectedRevision: 2,
          html: "Local reply writing",
          to: ["local@example.com"],
        })
      ),
    { timeout: 3000 }
  );
  expect(screen.getByText(/remote.txt/)).toBeInTheDocument();
  expect(mocked.replyToInboundMessage).not.toHaveBeenCalled();
});

it("keeps replaced reply writing and file bytes in a separate copy before using the saved version", async () => {
  const { savePendingDraft } = await import("../../lib/offline-drafts.js");
  const file = new File(["pending private bytes"], "local-pending.txt");
  await savePendingDraft({
    userId: "user_1",
    organizationId: "org_1",
    localId: "old-device-copy",
    draftId: "draft_1",
    revision: 1,
    payload: {
      inboundMessageId: "message_1",
      subject: "Re: Question",
      html: "Local with waiting bytes",
      to: ["local@example.com"],
      cc: [],
      bcc: [],
      listIds: [],
    },
    pendingUploads: [{ file, uploadId: "stable-pending", error: "Offline" }],
    updatedAt: "2026-10-15T13:00:00Z",
  });
  mocked.getEmailDraft.mockResolvedValue({
    id: "draft_1",
    organizationId: "org_1",
    revision: 2,
    html: "Saved replacement",
    to: ["saved@example.com"],
    attachments: [],
  } as never);
  const user = userEvent.setup();
  await renderReply();
  // A restored pending record carries the original revision even without a localStorage backup.
  await user.click(
    await screen.findByRole("button", { name: "Compare saved version" })
  );
  await screen.findByText("Saved version (read only)");
  await user.click(screen.getByRole("button", { name: "Use saved version" }));
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "Reply to Customer" })
    ).toHaveValue("Saved replacement")
  );
  expect(
    screen.queryByRole("button", { name: "Retry local-pending.txt" })
  ).not.toBeInTheDocument();
  const archive = (await listPendingDrafts("org_1")).find((copy) =>
    copy.localId.includes(".before.")
  );
  expect(archive).toMatchObject({
    payload: { html: "Local with waiting bytes" },
    pendingUploads: [{ file, uploadId: "stable-pending" }],
  });
  expect(mocked.replyToInboundMessage).not.toHaveBeenCalled();
});
