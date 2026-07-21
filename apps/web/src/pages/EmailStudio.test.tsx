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
    listRecipientSuggestions: vi.fn(),
    sendManualEmail: vi.fn(),
    previewEmail: vi.fn(),
    manualEmailStatus: vi.fn(),
    getEmailDraft: vi.fn(),
    createEmailDraft: vi.fn(),
    updateEmailDraft: vi.fn(),
    deleteEmailDraft: vi.fn(),
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
    listRecurringSends: vi.fn(),
    createRecurringSend: vi.fn(),
    pauseRecurringSend: vi.fn(),
    resumeRecurringSend: vi.fn(),
    deleteRecurringSend: vi.fn()
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
  mockedApi.listRecipientSuggestions.mockResolvedValue([]);
  mockedApi.listRecurringSends.mockResolvedValue([]);
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

async function renderStudio() {
  const result = render(
    <MemoryRouter>
      <EmailStudio />
    </MemoryRouter>
  );
  // Wait for the initial data load to resolve and the composer form to render.
  // The submit button only exists once `loading` flips to false, so this clears
  // the loading skeleton before the synchronous queries below run — otherwise
  // they race the skeleton and intermittently fail under load.
  await screen.findByRole("button", { name: /Send email/i });
  return result;
}

describe("EmailStudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = { currentOrganizationId: "org_1" };
  });

  it("warns and disables sending when there is no SMTP connection", async () => {
    setup({ withSmtp: false });
    await renderStudio();
    expect(await screen.findByText("No sending account yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send email/i })).toBeDisabled();
  });

  it("sends a manually composed email through the manual pipeline", async () => {
    const user = userEvent.setup();
    setup();
    await renderStudio();

    await user.type(screen.getByLabelText("To"), "rcpt@x.com{Enter}");
    await user.type(screen.getByLabelText("Subject"), "Hello there");
    await user.type(screen.getByLabelText("body-editor"), "<p>Body</p>");
    await user.click(screen.getByRole("button", { name: /Send email/i }));

    await waitFor(() => expect(mockedApi.sendManualEmail).toHaveBeenCalled());
    const payload = mockedApi.sendManualEmail.mock.calls[0][0];
    expect(payload.to).toEqual(["rcpt@x.com"]);
    expect(payload.subject).toBe("Hello there");
    expect(payload.html).toContain("Body");
    // Confirmations name the recipients, never the queue job id.
    expect(toast.success).toHaveBeenCalledWith("Sent to 1 person.");
  });

  it("adds contacts from the picker into the recipients", async () => {
    const user = userEvent.setup();
    setup();
    await renderStudio();

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
    await renderStudio();

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

  it("offers one-time scheduling", async () => {
    const user = userEvent.setup();
    setup();
    await renderStudio();

    await user.click(screen.getByLabelText("Schedule for later"));
    expect(screen.getByLabelText("Scheduled time")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Schedule email/i })
    ).toBeInTheDocument();
  });

  it("creates a recurring send instead of a one-off job when repeating", async () => {
    const user = userEvent.setup();
    setup();
    mockedApi.createRecurringSend.mockResolvedValue({
      id: "rs-1",
      status: "ACTIVE"
    });
    await renderStudio();

    await user.type(screen.getByLabelText("To"), "person@example.com{Enter}");
    await user.type(screen.getByLabelText("Subject"), "Weekly digest");
    await user.type(screen.getByLabelText("body-editor"), "<p>Digest</p>");
    await user.click(screen.getByLabelText("Repeat on a schedule"));

    expect(
      screen.getByRole("button", { name: /Create recurring send/i })
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Create recurring send/i })
    );

    await waitFor(() => {
      expect(mockedApi.createRecurringSend).toHaveBeenCalled();
    });
    // A recurrence must not also fire a one-off send.
    expect(mockedApi.sendManualEmail).not.toHaveBeenCalled();

    const payload = mockedApi.createRecurringSend.mock.calls[0][0];
    expect(payload).toMatchObject({
      subject: "Weekly digest",
      to: ["person@example.com"]
    });
    expect(payload.cronExpression).toBeTruthy();
  });

  it("loads a template into the composer without mutating it", async () => {
    const user = userEvent.setup();
    setup();
    await renderStudio();

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
    await renderStudio();

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
    await renderStudio();

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

  it("names the account the default From option actually sends as", async () => {
    setup();
    await renderStudio();

    // "Default sending account" on its own never told anyone which address it
    // would use.
    expect(
      screen.getByRole("combobox", { name: "From" })
    ).toHaveTextContent("Default · from@x.com");
  });

  it("keeps Cc and Bcc visible without hunting for a button", async () => {
    setup();
    await renderStudio();

    expect(screen.getByLabelText("Cc")).toBeInTheDocument();
    expect(screen.getByLabelText("Bcc")).toBeInTheDocument();
    expect(screen.queryByLabelText("Reply-To")).not.toBeInTheDocument();
  });

  it("autocompletes recipients from contacts and past sends", async () => {
    const user = userEvent.setup();
    setup();
    mockedApi.listRecipientSuggestions.mockResolvedValue([
      { email: "archived@x.com", source: "recent" }
    ]);
    await renderStudio();

    await user.type(screen.getByLabelText("To"), "a");

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "alice@x.com",
      "archived@x.comRecent"
    ]);

    await user.click(options[0]);
    // The chip replaces the typed text, so the list closes.
    expect(screen.getByLabelText("Remove alice@x.com")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("selects a suggestion with the keyboard", async () => {
    const user = userEvent.setup();
    setup();
    await renderStudio();

    await user.type(screen.getByLabelText("To"), "b");
    await user.keyboard("{Enter}");

    expect(screen.getByLabelText("Remove bob@x.com")).toBeInTheDocument();
  });

  it("still accepts an address that matches no suggestion", async () => {
    const user = userEvent.setup();
    setup();
    await renderStudio();

    await user.type(screen.getByLabelText("To"), "nobody@elsewhere.com{Enter}");

    expect(
      screen.getByLabelText("Remove nobody@elsewhere.com")
    ).toBeInTheDocument();
  });

  it("confirms before a template overwrites a started message", async () => {
    const user = userEvent.setup();
    setup();
    await renderStudio();

    await user.type(screen.getByLabelText("Subject"), "My own subject");
    await user.click(screen.getByRole("combobox", { name: "Template" }));
    await user.click(await screen.findByRole("option", { name: "Welcome" }));

    // Nothing is replaced until the confirmation is accepted.
    expect(screen.getByLabelText("Subject")).toHaveValue("My own subject");
    await user.click(screen.getByRole("button", { name: "Use template" }));
    expect(screen.getByLabelText("Subject")).toHaveValue("Welcome aboard");
  });

  it("confirms a scheduled send by time instead of job id", async () => {
    const user = userEvent.setup();
    setup();
    mockedApi.sendManualEmail.mockResolvedValue({
      id: "job1",
      status: "QUEUED"
    });
    await renderStudio();

    await user.type(screen.getByLabelText("To"), "rcpt@x.com{Enter}");
    await user.type(screen.getByLabelText("Subject"), "Hi");
    await user.type(screen.getByLabelText("body-editor"), "<p>Body</p>");
    await user.click(screen.getByLabelText("Schedule for later"));
    const future = new Date(Date.now() + 60 * 60 * 1000)
      .toISOString()
      .slice(0, 16);
    await user.type(screen.getByLabelText("Scheduled time"), future);
    await user.click(screen.getByRole("button", { name: /Schedule email/i }));

    await waitFor(() => expect(mockedApi.sendManualEmail).toHaveBeenCalled());
    const [message] = toast.success.mock.calls.at(-1)!;
    expect(message).toMatch(/^Scheduled — sends /);
    expect(message).not.toContain("job1");
  });

  it("shows per-recipient delivery status after sending", async () => {
    const user = userEvent.setup();
    setup();
    await renderStudio();

    await user.type(screen.getByLabelText("To"), "rcpt@x.com{Enter}");
    await user.type(screen.getByLabelText("Subject"), "Hi");
    await user.type(screen.getByLabelText("body-editor"), "<p>Body</p>");
    await user.click(screen.getByRole("button", { name: /Send email/i }));

    await waitFor(() => expect(mockedApi.manualEmailStatus).toHaveBeenCalled());
    const panel = await screen.findByTestId("delivery-status");
    expect(within(panel).getByText("rcpt@x.com")).toBeInTheDocument();
    expect(within(panel).getByText("delivered")).toBeInTheDocument();
  });
});
