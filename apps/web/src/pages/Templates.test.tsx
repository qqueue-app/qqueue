import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const session = vi.hoisted(() => ({ current: { currentOrganizationId: "org_1" } }));
vi.mock("../lib/session-context.js", () => ({ useSession: () => session.current }));

vi.mock("../lib/api.js", () => ({
  api: {
    listTemplates: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn()
  }
}));

// Stub the rich text editor with a simple textarea so we can drive `onChange`.
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

import { Templates } from "./Templates.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const template = {
  id: "t1",
  organizationId: "org_1",
  name: "Welcome",
  subject: "Hi {{firstName}}",
  html: "<p>Hello</p>",
  text: "Hello"
};

describe("Templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = { currentOrganizationId: "org_1" };
  });

  it("shows the empty state", async () => {
    mockedApi.listTemplates.mockResolvedValue([]);
    render(<Templates />);
    expect(await screen.findByText("No templates yet")).toBeInTheDocument();
  });

  it("renders existing templates", async () => {
    mockedApi.listTemplates.mockResolvedValue([template]);
    render(<Templates />);
    expect(await screen.findByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("Hi {{firstName}}")).toBeInTheDocument();
  });

  it("rejects an empty body on create", async () => {
    const user = userEvent.setup();
    mockedApi.listTemplates.mockResolvedValue([]);
    render(<Templates />);
    await screen.findByText("No templates yet");
    await user.click(
      screen.getAllByRole("button", { name: /New template/i })[0]
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "T");
    await user.type(within(dialog).getByLabelText("Subject"), "S");
    await user.click(
      within(dialog).getByRole("button", { name: "Create template" })
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("The email body cannot be empty.")
    );
    expect(mockedApi.createTemplate).not.toHaveBeenCalled();
  });

  it("creates a template with a body", async () => {
    const user = userEvent.setup();
    mockedApi.listTemplates.mockResolvedValue([]);
    mockedApi.createTemplate.mockResolvedValue({ id: "t2" });
    render(<Templates />);
    await screen.findByText("No templates yet");
    await user.click(
      screen.getAllByRole("button", { name: /New template/i })[0]
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "T");
    await user.type(within(dialog).getByLabelText("Subject"), "S");
    await user.type(
      within(dialog).getByLabelText("body-editor"),
      "<p>Body</p>"
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create template" })
    );
    await waitFor(() => expect(mockedApi.createTemplate).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Template saved.");
  });

  it("edits an existing template", async () => {
    const user = userEvent.setup();
    mockedApi.listTemplates.mockResolvedValue([template]);
    mockedApi.updateTemplate.mockResolvedValue({ id: "t1" });
    render(<Templates />);
    await screen.findByText("Welcome");
    await user.click(screen.getByLabelText("Edit template"));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" })
    );
    await waitFor(() =>
      expect(mockedApi.updateTemplate).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ name: "Welcome" })
      )
    );
  });

  it("deletes a template", async () => {
    const user = userEvent.setup();
    mockedApi.listTemplates.mockResolvedValue([template]);
    mockedApi.deleteTemplate.mockResolvedValue(undefined);
    render(<Templates />);
    await screen.findByText("Welcome");
    await user.click(screen.getByLabelText("Delete template"));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockedApi.deleteTemplate).toHaveBeenCalledWith("t1")
    );
  });

  it("toasts on load failure", async () => {
    mockedApi.listTemplates.mockRejectedValue(new Error("fail"));
    render(<Templates />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("fail"));
  });
});
