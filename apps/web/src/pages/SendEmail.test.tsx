import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const session = vi.hoisted(() => ({ current: { currentOrganizationId: "org_1" } }));
vi.mock("../lib/session-context.js", () => ({ useSession: () => session.current }));

vi.mock("../lib/api.js", () => ({
  api: {
    listTemplates: vi.fn(),
    listSMTPConnections: vi.fn(),
    sendEmail: vi.fn()
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

import { SendEmail } from "./SendEmail.js";
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
    subject: "Hi {{firstName}}",
    html: "<p>Hello {{firstName}}</p>",
    text: "Hello"
  }
];

function renderSendEmail() {
  return render(
    <MemoryRouter>
      <SendEmail />
    </MemoryRouter>
  );
}

describe("SendEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = { currentOrganizationId: "org_1" };
  });

  it("warns when there are no SMTP connections", async () => {
    mockedApi.listTemplates.mockResolvedValue([]);
    mockedApi.listSMTPConnections.mockResolvedValue([]);
    renderSendEmail();
    expect(await screen.findByText("No SMTP connection yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send email" })).toBeDisabled();
  });

  it("sends a plain email", async () => {
    const user = userEvent.setup();
    mockedApi.listTemplates.mockResolvedValue(templates);
    mockedApi.listSMTPConnections.mockResolvedValue(smtp);
    mockedApi.sendEmail.mockResolvedValue({ id: "job1", status: "QUEUED" });
    renderSendEmail();
    await waitFor(() =>
      expect(mockedApi.listSMTPConnections).toHaveBeenCalled()
    );
    await user.type(screen.getByLabelText("To"), "rcpt@x.com");
    await user.type(screen.getByLabelText("Subject"), "Hello there");
    await user.click(screen.getByRole("button", { name: "Send email" }));
    await waitFor(() => expect(mockedApi.sendEmail).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("job job1")
    );
  });

  it("renders the preview tab", async () => {
    const user = userEvent.setup();
    mockedApi.listTemplates.mockResolvedValue(templates);
    mockedApi.listSMTPConnections.mockResolvedValue(smtp);
    renderSendEmail();
    await waitFor(() =>
      expect(mockedApi.listSMTPConnections).toHaveBeenCalled()
    );
    await user.type(screen.getByLabelText("Subject"), "Preview me");
    await user.click(screen.getByRole("button", { name: /Preview/i }));
    expect(screen.getByText("Preview me")).toBeInTheDocument();
  });

  it("loads a template's content when template mode is enabled", async () => {
    const user = userEvent.setup();
    mockedApi.listTemplates.mockResolvedValue(templates);
    mockedApi.listSMTPConnections.mockResolvedValue(smtp);
    renderSendEmail();
    await waitFor(() =>
      expect(mockedApi.listSMTPConnections).toHaveBeenCalled()
    );
    await user.click(screen.getByText("Use a saved template"));
    // template select appears
    expect(await screen.findByText("Template")).toBeInTheDocument();
  });

  it("validates a scheduled time in the past", async () => {
    const user = userEvent.setup();
    mockedApi.listTemplates.mockResolvedValue([]);
    mockedApi.listSMTPConnections.mockResolvedValue(smtp);
    renderSendEmail();
    await waitFor(() =>
      expect(mockedApi.listSMTPConnections).toHaveBeenCalled()
    );
    await user.type(screen.getByLabelText("To"), "rcpt@x.com");
    await user.click(screen.getByText("Schedule for later"));
    const dt = screen.getByLabelText("Send at");
    await user.type(dt, "2000-01-01T00:00");
    await user.click(screen.getByRole("button", { name: "Schedule email" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Scheduled time must be in the future."
      )
    );
  });

  it("toasts on load failure", async () => {
    mockedApi.listTemplates.mockRejectedValue(new Error("load err"));
    mockedApi.listSMTPConnections.mockResolvedValue(smtp);
    renderSendEmail();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("load err"));
  });
});
