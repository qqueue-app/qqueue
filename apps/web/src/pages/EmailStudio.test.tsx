import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const session = vi.hoisted(() => ({
  current: { currentOrganizationId: "org_1" }
}));
vi.mock("../lib/session-context.js", () => ({
  useSession: () => session.current
}));

vi.mock("../lib/api.js", () => ({
  api: {
    listTemplates: vi.fn(),
    listSMTPConnections: vi.fn(),
    listContacts: vi.fn(),
    listContactLists: vi.fn(),
    listEmailDrafts: vi.fn(),
    sendManualEmail: vi.fn(),
    previewEmail: vi.fn(),
    manualEmailStatus: vi.fn(),
    getEmailDraft: vi.fn(),
    createEmailDraft: vi.fn(),
    updateEmailDraft: vi.fn(),
    deleteEmailDraft: vi.fn(),
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn()
  }
}));

vi.mock("../components/editor/RichTextEditor.js", () => ({
  RichTextEditor: ({
    value,
    onChange
  }: {
    value: string;
    onChange: (html: string) => void;
  }) => (
    <textarea
      aria-label="body-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}));

import { EmailStudio } from "./EmailStudio.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const smtp = [
  {
    id: "s1",
    organizationId: "org_1",
    name: "Primary",
    host: "smtp.x",
    port: 587,
    secure: false,
    fromEmail: "from@x.com",
    isDefault: true
  }
];

const templates = [
  {
    id: "t1",
    organizationId: "org_1",
    name: "Welcome",
    subject: "Welcome aboard",
    html: "<p>Hello there</p>"
  }
];

const contacts = [
  { id: "c1", organizationId: "org_1", email: "alice@x.com", status: "ACTIVE" },
  { id: "c2", organizationId: "org_1", email: "bob@x.com", status: "ACTIVE" }
];

const lists = [
  {
    id: "list_1",
    organizationId: "org_1",
    name: "VIPs",
    _count: { contacts: 5, campaigns: 0 }
  }
];

function setup({ withSmtp = true } = {}) {
  mockedApi.listTemplates.mockResolvedValue(templates);
  mockedApi.listSMTPConnections.mockResolvedValue(withSmtp ? smtp : []);
  mockedApi.listContacts.mockResolvedValue(contacts);
  mockedApi.listContactLists.mockResolvedValue(lists);
  mockedApi.listEmailDrafts.mockResolvedValue([]);
  mockedApi.sendManualEmail.mockResolvedValue({ id: "job1", status: "SENT" });
  mockedApi.previewEmail.mockResolvedValue({
    subject: "Hi",
    html: "<p>rendered body</p>",
    recipients: { to: ["alice@x.com"], cc: [], bcc: [], total: 1 }
  });
  mockedApi.createEmailDraft.mockResolvedValue({ id: "d1", updatedAt: "now" });
  mockedApi.updateEmailDraft.mockResolvedValue({ id: "d1", updatedAt: "now" });
  mockedApi.deleteEmailDraft.mockResolvedValue(undefined);
  mockedApi.manualEmailStatus.mockResolvedValue({
    id: "job1",
    status: "SENT",
    sentAt: "now",
    recipients: [{ email: "rcpt@x.com", field: "to", status: "delivered" }],
    opens: 0,
    clicks: 0,
    bounces: 0,
    complaints: 0
  });
  mockedApi.uploadAttachment.mockResolvedValue({
    id: "att1",
    filename: "doc.pdf",
    contentType: "application/pdf",
    size: 2048
  });
  mockedApi.deleteAttachment.mockResolvedValue(undefined);
}

function renderStudio() {
  return render(
    <MemoryRouter>
      <EmailStudio />
    </MemoryRouter>
  );
}

describe("EmailStudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = { currentOrganizationId: "org_1" };
  });

  it("warns and disables sending when there is no SMTP connection", async () => {
    setup({ withSmtp: false });
    renderStudio();
    expect(await screen.findByText("No sending account yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send email/i })).toBeDisabled();
  });

  it("sends a manually composed email through the manual pipeline", async () => {
    const user = userEvent.setup();
    setup();
    renderStudio();
    await waitFor(() =>
      expect(mockedApi.listSMTPConnections).toHaveBeenCalled()
    );

    await user.type(screen.getByLabelText("To"), "rcpt@x.com{Enter}");
    await user.type(screen.getByLabelText("Subject"), "Hello there");
    await user.type(screen.getByLabelText("body-editor"), "<p>Body</p>");
    await user.click(screen.getByRole("button", { name: /Send email/i }));

    await waitFor(() => expect(mockedApi.sendManualEmail).toHaveBeenCalled());
    const payload = mockedApi.sendManualEmail.mock.calls[0][0];
    expect(payload.to).toEqual(["rcpt@x.com"]);
    expect(payload.subject).toBe("Hello there");
    expect(payload.html).toContain("Body");
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("job1")
    );
  });

  it("adds contacts from the picker into the recipients", async () => {
    const user = userEvent.setup();
    setup();
    renderStudio();
    await waitFor(() => expect(mockedApi.listContacts).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Add contacts/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByLabelText("Select alice@x.com"));
    await user.click(within(dialog).getByRole("button", { name: /Add 1 contact/i }));

    await user.type(screen.getByLabelText("Subject"), "Hi");
    await user.type(screen.getByLabelText("body-editor"), "<p>Body</p>");
    await user.click(screen.getByRole("button", { name: /Send email/i }));

    await waitFor(() => expect(mockedApi.sendManualEmail).toHaveBeenCalled());
    expect(mockedApi.sendManualEmail.mock.calls[0][0].to).toContain(
      "alice@x.com"
    );
  });

  it("sends to a selected contact list", async () => {
    const user = userEvent.setup();
    setup();
    renderStudio();
    await waitFor(() => expect(mockedApi.listContactLists).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Add list/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByLabelText("Select VIPs"));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    await user.type(screen.getByLabelText("Subject"), "Hi");
    await user.type(screen.getByLabelText("body-editor"), "<p>Body</p>");
    await user.click(screen.getByRole("button", { name: /Send email/i }));

    await waitFor(() => expect(mockedApi.sendManualEmail).toHaveBeenCalled());
    expect(mockedApi.sendManualEmail.mock.calls[0][0].listIds).toEqual([
      "list_1"
    ]);
  });

  it("offers one-time scheduling but not recurring on a one-off send", async () => {
    const user = userEvent.setup();
    setup();
    renderStudio();
    await waitFor(() =>
      expect(mockedApi.listSMTPConnections).toHaveBeenCalled()
    );

    // Recurring isn't supported for one-off Compose sends, so it's hidden.
    expect(
      screen.queryByLabelText("Repeat on a schedule")
    ).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Schedule for later"));
    expect(screen.getByLabelText("Scheduled time")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Schedule email/i })
    ).toBeInTheDocument();
  });

  it("loads a template into the composer without mutating it", async () => {
    const user = userEvent.setup();
    setup();
    renderStudio();
    await waitFor(() => expect(mockedApi.listTemplates).toHaveBeenCalled());

    await user.click(screen.getByRole("combobox", { name: "Template" }));
    await user.click(await screen.findByRole("option", { name: "Welcome" }));

    // Selecting a template now loads it immediately (no separate button).
    expect(screen.getByLabelText("Subject")).toHaveValue("Welcome aboard");
    // Loading a template never writes back to it.
    expect(mockedApi.updateEmailDraft).not.toHaveBeenCalledWith(
      "t1",
      expect.anything()
    );
  });

  it("uploads an attachment and includes it in the send", async () => {
    const user = userEvent.setup();
    setup();
    renderStudio();
    await waitFor(() =>
      expect(mockedApi.listSMTPConnections).toHaveBeenCalled()
    );

    const file = new File(["pdf-bytes"], "doc.pdf", {
      type: "application/pdf"
    });
    await user.upload(screen.getByLabelText("Add attachments"), file);

    // The uploaded file appears in the attachment list.
    expect(await screen.findByText("doc.pdf")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedApi.uploadAttachment).toHaveBeenCalled()
    );
    // A draft is ensured first so the attachment links to it.
    expect(mockedApi.createEmailDraft).toHaveBeenCalled();
    expect(mockedApi.uploadAttachment.mock.calls[0][1]).toMatchObject({
      organizationId: "org_1",
      emailDraftId: "d1"
    });

    await user.type(screen.getByLabelText("To"), "rcpt@x.com{Enter}");
    await user.type(screen.getByLabelText("Subject"), "Hi");
    await user.type(screen.getByLabelText("body-editor"), "<p>Body</p>");
    await user.click(screen.getByRole("button", { name: /Send email/i }));

    await waitFor(() => expect(mockedApi.sendManualEmail).toHaveBeenCalled());
    expect(mockedApi.sendManualEmail.mock.calls[0][0].attachmentIds).toEqual([
      "att1"
    ]);
  });

  it("removes an attachment from the list", async () => {
    const user = userEvent.setup();
    setup();
    renderStudio();
    await waitFor(() =>
      expect(mockedApi.listSMTPConnections).toHaveBeenCalled()
    );

    const file = new File(["pdf-bytes"], "doc.pdf", {
      type: "application/pdf"
    });
    await user.upload(screen.getByLabelText("Add attachments"), file);
    expect(await screen.findByText("doc.pdf")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Remove doc.pdf/i }));

    await waitFor(() =>
      expect(mockedApi.deleteAttachment).toHaveBeenCalledWith("att1")
    );
    expect(screen.queryByText("doc.pdf")).not.toBeInTheDocument();
  });

  it("shows per-recipient delivery status after sending", async () => {
    const user = userEvent.setup();
    setup();
    renderStudio();
    await waitFor(() =>
      expect(mockedApi.listSMTPConnections).toHaveBeenCalled()
    );

    await user.type(screen.getByLabelText("To"), "rcpt@x.com{Enter}");
    await user.type(screen.getByLabelText("Subject"), "Hi");
    await user.type(screen.getByLabelText("body-editor"), "<p>Body</p>");
    await user.click(screen.getByRole("button", { name: /Send email/i }));

    await waitFor(() => expect(mockedApi.manualEmailStatus).toHaveBeenCalled());
    const panel = await screen.findByTestId("delivery-status");
    expect(within(panel).getByText("rcpt@x.com")).toBeInTheDocument();
    expect(within(panel).getByText("delivered")).toBeInTheDocument();
  });

  it("generates a preview through the shared render pipeline", async () => {
    const user = userEvent.setup();
    setup();
    renderStudio();
    await waitFor(() => expect(mockedApi.listSMTPConnections).toHaveBeenCalled());

    await user.type(screen.getByLabelText("Subject"), "Hi");
    await user.type(screen.getByLabelText("body-editor"), "<p>Body</p>");
    await user.click(screen.getByRole("button", { name: /Preview/i }));

    await waitFor(() => expect(mockedApi.previewEmail).toHaveBeenCalled());
    // The preview is rendered inside a sandboxed iframe so the email's own
    // styles cannot leak into the dashboard; assert on its srcdoc document.
    expect(await screen.findByTestId("preview-body")).toHaveAttribute(
      "srcdoc",
      expect.stringContaining("rendered body")
    );
  });
});
