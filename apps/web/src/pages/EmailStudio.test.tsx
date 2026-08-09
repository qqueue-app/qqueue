import { renderWithProviders, screen, waitFor, within } from "../test/render.js";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  // Used by actions that report progress before their result.
  loading: vi.fn(),
  message: vi.fn()
}));
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
    listSendableSMTPConnections: vi.fn(),
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
    replyTo: "support@x.com",
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
  mockedApi.listSendableSMTPConnections.mockResolvedValue(withSmtp ? smtp : []);
  mockedApi.listContacts.mockResolvedValue(contacts);
  mockedApi.listContactLists.mockResolvedValue(lists);
  mockedApi.listEmailDrafts.mockResolvedValue([]);
  mockedApi.listRecipientSuggestions.mockResolvedValue([]);
  mockedApi.listRecurringSends.mockResolvedValue([]);
  // Every send is queued now — the API accepts the job; the worker delivers it.
  mockedApi.sendManualEmail.mockResolvedValue({ id: "job1", status: "QUEUED" });
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
  const result = renderWithProviders(
    <MemoryRouter>
      <EmailStudio />
    </MemoryRouter>
  , { withRouter: false });
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
    // The composer confirms the queue handoff immediately (naming recipients,
    // never the job id), then reports the real outcome once the poll sees the
    // worker settle the job.
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Queued — sending to 1 person.",
        expect.objectContaining({ action: expect.anything() })
      )
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Sent to 1 person.")
    );
  });

  it("reports a failed delivery after the send was accepted", async () => {
    const user = userEvent.setup();
    setup();
    mockedApi.manualEmailStatus.mockResolvedValue({
      id: "job1",
      status: "FAILED",
      sentAt: null,
      recipients: [{ email: "rcpt@x.com", field: "to", status: "failed" }],
      opens: 0,
      clicks: 0,
      bounces: 0,
      complaints: 0
    });
    await renderStudio();

    await user.type(screen.getByLabelText("To"), "rcpt@x.com{Enter}");
    await user.type(screen.getByLabelText("Subject"), "Hello there");
    await user.type(screen.getByLabelText("body-editor"), "<p>Body</p>");
    await user.click(screen.getByRole("button", { name: /Send email/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "The email could not be delivered — check the outbox for details."
      )
    );
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

  // Progressive disclosure (§3): most sends copy nobody, so Cc/Bcc start
  // folded away behind a text button rather than costing two fields of the
  // form column on every message.
  it("hides Cc and Bcc behind a reveal", async () => {
    const user = userEvent.setup();
    setup();
    await renderStudio();

    expect(screen.queryByLabelText("Cc")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Bcc")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Reply-To")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cc / Bcc / Reply-To" }));

    expect(screen.getByLabelText("Cc")).toBeInTheDocument();
    expect(screen.getByLabelText("Bcc")).toBeInTheDocument();
    // Once the fields are on screen the reveal is gone — a "hide" that refuses
    // to hide because you typed into it is worse than no button.
    expect(
      screen.queryByRole("button", { name: "Cc / Bcc / Reply-To" })
    ).not.toBeInTheDocument();
  });

  /*
    A blank Reply-To does not mean "no Reply-To" — the send inherits the
    sending account's default. The field has to say which address that is, or
    an empty box reads as "replies go nowhere in particular".
  */
  it("shows the account's default Reply-To as the field's placeholder", async () => {
    const user = userEvent.setup();
    setup();
    await renderStudio();

    await user.click(screen.getByRole("button", { name: "Cc / Bcc / Reply-To" }));

    expect(screen.getByLabelText("Reply-To")).toHaveAttribute(
      "placeholder",
      "support@x.com"
    );
    expect(
      screen.getByText(/Overrides this account's default of support@x.com/)
    ).toBeInTheDocument();
  });

  it("omits Reply-To from the send when the field is left blank", async () => {
    const user = userEvent.setup();
    setup();
    await renderStudio();

    await user.type(screen.getByLabelText("To"), "rcpt@x.com{Enter}");
    await user.type(screen.getByLabelText("Subject"), "Hi");
    await user.type(screen.getByLabelText("body-editor"), "<p>Body</p>");
    await user.click(screen.getByRole("button", { name: /Send email/i }));

    await waitFor(() => expect(mockedApi.sendManualEmail).toHaveBeenCalled());
    // Undefined rather than "": the worker is what resolves the account
    // default, and an empty string would be a Reply-To header of nothing.
    expect(mockedApi.sendManualEmail.mock.calls[0][0].replyTo).toBeUndefined();
  });

  it("sends a one-off Reply-To that overrides the account default", async () => {
    const user = userEvent.setup();
    setup();
    await renderStudio();

    await user.click(screen.getByRole("button", { name: "Cc / Bcc / Reply-To" }));
    await user.type(screen.getByLabelText("Reply-To"), "just-this-one@x.com");
    await user.type(screen.getByLabelText("To"), "rcpt@x.com{Enter}");
    await user.type(screen.getByLabelText("Subject"), "Hi");
    await user.type(screen.getByLabelText("body-editor"), "<p>Body</p>");
    await user.click(screen.getByRole("button", { name: /Send email/i }));

    await waitFor(() => expect(mockedApi.sendManualEmail).toHaveBeenCalled());
    expect(mockedApi.sendManualEmail.mock.calls[0][0].replyTo).toBe(
      "just-this-one@x.com"
    );
  });

  // A folded-away field must never swallow content that already exists.
  it("opens Cc and Bcc for a draft that already has them", async () => {
    setup();
    mockedApi.listEmailDrafts.mockResolvedValue([]);
    mockedApi.getEmailDraft.mockResolvedValue({
      id: "d9",
      subject: "Resumed",
      html: "<p>Body</p>",
      to: ["alice@x.com"],
      cc: ["carbon@x.com"],
      bcc: [],
      listIds: [],
      attachments: [],
      updatedAt: "now"
    });

    renderWithProviders(
      <MemoryRouter initialEntries={["/email-studio?draft=d9"]}>
        <EmailStudio />
      </MemoryRouter>,
      { withRouter: false }
    );

    expect(await screen.findByLabelText("Cc")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove carbon@x.com")).toBeInTheDocument();
  });

  it("hides attachments behind a reveal until there is one", async () => {
    const user = userEvent.setup();
    setup();
    await renderStudio();

    expect(
      screen.queryByRole("button", { name: /Add files/i })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Attachments/i }));

    expect(
      screen.getByRole("button", { name: /Add files/i })
    ).toBeInTheDocument();
  });

  // The rail holds this message's options only; the list of every recurring
  // send in the org is a page of its own now (§4).
  it("links out to the recurring sends page instead of listing them", async () => {
    setup();
    await renderStudio();

    expect(mockedApi.listRecurringSends).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: /Manage recurring sends/i })
    ).toHaveAttribute("href", "/campaigns/recurring");
  });

  /*
    §2's one-scroll rule, as a test rather than as a promise. The rail used to
    hold a list that grew without bound inside a fixed card, and the fix is
    structural: nothing in the composer may declare a scroll region or a height
    that would force one. The combobox listbox is the single exception the
    design system names, and it is a floating overlay that cannot extend the
    page.
  */
  it("creates no scroll region of its own anywhere in the form", async () => {
    const user = userEvent.setup();
    setup();
    const { container } = await renderStudio();

    // Anything that caps its own height or asks for its own overflow. Class
    // names rather than layout, because jsdom has none — but this is exactly
    // how such a region would be introduced.
    function scrollRegionsInForm() {
      const form = container.querySelector("form")!;
      return Array.from(form.querySelectorAll<HTMLElement>("*"))
        .filter(
          (element) =>
            typeof element.className === "string" &&
            /(^|\s)(max-h-|overflow-(y-)?(auto|scroll))/.test(element.className)
        )
        .map((element) => element.getAttribute("role") ?? element.tagName);
    }

    // First prove the detector can see one: the recipient combobox's listbox
    // is the single exception §2 allows, and it is a floating overlay that
    // cannot extend the page.
    await user.type(screen.getByLabelText("To"), "a");
    expect(scrollRegionsInForm()).toEqual(["listbox"]);

    // Now the composer in the state that used to overflow the rail: recipient
    // chips, an open recurrence, and the attachment tray revealed.
    await user.keyboard("{Enter}");
    await user.click(screen.getByLabelText("Repeat on a schedule"));
    await user.click(screen.getByRole("button", { name: /Attachments/i }));

    expect(scrollRegionsInForm()).toEqual([]);
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

  // Previewing server-side is the point: it runs the same MJML wrap and tracking
  // injection the send does, so a pasted document or a tracked link looks in the
  // preview exactly like it will in the recipient's inbox.
  it("renders the server-rendered preview of the composed message", async () => {
    const user = userEvent.setup();
    setup();
    await renderStudio();

    await user.type(screen.getByLabelText("To"), "alice@x.com{Enter}");
    await user.type(screen.getByLabelText("Subject"), "Hi");
    await user.type(screen.getByLabelText("body-editor"), "<p>Body</p>");
    await user.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() => expect(mockedApi.previewEmail).toHaveBeenCalled());
    const [input] = mockedApi.previewEmail.mock.calls[0];
    expect(input).toMatchObject({
      organizationId: "org_1",
      subject: "Hi",
      html: "<p>Body</p>",
      to: ["alice@x.com"]
    });

    const frame = await screen.findByTestId("composer-preview");
    expect(frame.getAttribute("srcdoc")).toContain("<p>rendered body</p>");
    // The recipient summary comes from the server's resolved set, not the chips.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("alice@x.com")).toBeInTheDocument();
  });

  it("refuses to preview an empty body instead of calling the API", async () => {
    const user = userEvent.setup();
    setup();
    await renderStudio();

    await user.type(screen.getByLabelText("Subject"), "Hi");
    await user.click(screen.getByRole("button", { name: /preview/i }));

    expect(mockedApi.previewEmail).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Write something to preview.");
  });

  /*
    Class names rather than layout, because jsdom has none — but the container
    and the measure are classes, so this is exactly how the alignment breaks.
  */
  describe("page measure", () => {
    function measured(container: HTMLElement) {
      return Array.from(container.querySelectorAll<HTMLElement>(".max-w-page"));
    }

    it("puts the header and the composer on one shared measure", async () => {
      setup();
      const { container } = await renderStudio();

      // The header's text and the composer resolve their measure from the same
      // two constants, so the title lands on the form's left edge and Drafts /
      // Save draft on the rail's right. Two independent copies of the number is
      // exactly how they drifted apart before.
      const elements = measured(container);
      expect(elements).toHaveLength(2);
      elements.forEach((element) => expect(element).toHaveClass("mx-auto"));

      // The form track is fluid, so the cluster fills the page instead of
      // leaving a gutter. Nothing here states a width of its own.
      const form = container.querySelector("form")!;
      expect(form.className).toContain("xl:grid-cols-[minmax(0,1fr)_var(--content-rail)]");
      expect(form.className).not.toMatch(/max-w-|mx-auto/);
    });

    it("puts the loading skeleton where the form will land", async () => {
      setup();
      // Deliberately not `renderStudio`: that waits the skeleton out, and the
      // jump this guards against happens exactly as it disappears.
      const { container } = renderWithProviders(
        <MemoryRouter>
          <EmailStudio />
        </MemoryRouter>,
        { withRouter: false }
      );

      // The skeleton inherits the measure from the container rather than
      // carrying its own, so loading cannot end with the composer moving.
      expect(measured(container)).toHaveLength(2);

      // Let the load finish before the test ends, or its state updates land
      // outside `act` and warn.
      await screen.findByRole("button", { name: /Send email/i });
    });
  });
});
