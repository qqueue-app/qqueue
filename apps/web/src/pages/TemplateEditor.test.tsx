import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
    getTemplate: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    testSendTemplate: vi.fn()
  }
}));

// Stub the rich text editor with a textarea so tests can drive `onChange`.
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
      onChange={(event) => onChange(event.target.value)}
    />
  )
}));

// The preview renders a sandboxed iframe; not needed for behaviour tests.
vi.mock("../components/editor/TemplatePreview.js", () => ({
  TemplatePreview: () => <div data-testid="preview" />
}));

import { TemplateEditor } from "./TemplateEditor.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/templates" element={<div>templates list</div>} />
        <Route path="/templates/new" element={<TemplateEditor />} />
        <Route path="/templates/:id/edit" element={<TemplateEditor />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("TemplateEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = { currentOrganizationId: "org_1" };
  });

  it("seeds a starter when ?starter is provided", async () => {
    renderAt("/templates/new?starter=welcome");
    expect(await screen.findByDisplayValue("Welcome")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Welcome to {{company}}, {{firstName}}!")
    ).toBeInTheDocument();
  });

  it("rejects an empty body on create", async () => {
    const user = userEvent.setup();
    renderAt("/templates/new");
    await user.type(screen.getByLabelText("Name"), "T");
    await user.type(screen.getByLabelText("Subject"), "S");
    await user.click(screen.getByRole("button", { name: "Create template" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("The email body cannot be empty.")
    );
    expect(mockedApi.createTemplate).not.toHaveBeenCalled();
  });

  it("creates a template with a body", async () => {
    const user = userEvent.setup();
    mockedApi.createTemplate.mockResolvedValue({ id: "t2" });
    renderAt("/templates/new");
    await user.type(screen.getByLabelText("Name"), "T");
    await user.type(screen.getByLabelText("Subject"), "S");
    await user.clear(screen.getByLabelText("body-editor"));
    await user.type(screen.getByLabelText("body-editor"), "<p>Body</p>");
    await user.click(screen.getByRole("button", { name: "Create template" }));
    await waitFor(() =>
      expect(mockedApi.createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "T", subject: "S", html: "<p>Body</p>" })
      )
    );
    expect(await screen.findByText("templates list")).toBeInTheDocument();
  });

  it("loads an existing template for editing", async () => {
    mockedApi.getTemplate.mockResolvedValue({
      id: "t1",
      organizationId: "org_1",
      name: "Welcome",
      subject: "Hi",
      html: "<p>Hello</p>",
      category: "Onboarding",
      tags: ["a"],
      variables: [{ name: "firstName", defaultValue: "Sam" }]
    });
    renderAt("/templates/t1/edit");
    expect(await screen.findByDisplayValue("Welcome")).toBeInTheDocument();
    expect(mockedApi.getTemplate).toHaveBeenCalledWith("t1");
    // Declared variable surfaces in the variables panel.
    expect(screen.getByText("{{firstName}}")).toBeInTheDocument();
  });
});
