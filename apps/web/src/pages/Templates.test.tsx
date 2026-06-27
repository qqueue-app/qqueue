import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

const session = vi.hoisted(() => ({
  current: { currentOrganizationId: "org_1" }
}));
vi.mock("../lib/session-context.js", () => ({
  useSession: () => session.current
}));

vi.mock("../lib/api.js", () => ({
  api: {
    listTemplates: vi.fn(),
    cloneTemplate: vi.fn(),
    deleteTemplate: vi.fn()
  }
}));

import { Templates } from "./Templates.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const template = {
  id: "t1",
  organizationId: "org_1",
  name: "Welcome",
  subject: "Hi {{firstName}}",
  category: "Onboarding",
  tags: ["greeting"],
  html: "<p>Hello</p>",
  text: "Hello"
};

function renderPage() {
  return render(
    <MemoryRouter>
      <Templates />
    </MemoryRouter>
  );
}

describe("Templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = { currentOrganizationId: "org_1" };
  });

  it("shows the empty state", async () => {
    mockedApi.listTemplates.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("No templates yet")).toBeInTheDocument();
  });

  it("renders existing templates with category and tags", async () => {
    mockedApi.listTemplates.mockResolvedValue([template]);
    renderPage();
    expect(await screen.findByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("Hi {{firstName}}")).toBeInTheDocument();
    expect(screen.getByText("greeting")).toBeInTheDocument();
  });

  it("opens the starter gallery and navigates to the editor", async () => {
    const user = userEvent.setup();
    mockedApi.listTemplates.mockResolvedValue([]);
    renderPage();
    await screen.findByText("No templates yet");
    await user.click(
      screen.getAllByRole("button", { name: /New template/i })[0]
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Welcome"));
    expect(navigate).toHaveBeenCalledWith("/templates/new?starter=welcome");
  });

  it("filters templates by search term", async () => {
    const user = userEvent.setup();
    mockedApi.listTemplates.mockResolvedValue([
      template,
      { ...template, id: "t2", name: "Receipt", subject: "Your receipt" }
    ]);
    renderPage();
    await screen.findByText("Welcome");
    await user.type(screen.getByPlaceholderText("Search templates…"), "receipt");
    await waitFor(() =>
      expect(screen.queryByText("Welcome")).not.toBeInTheDocument()
    );
    expect(screen.getByText("Receipt")).toBeInTheDocument();
  });

  it("duplicates a template", async () => {
    const user = userEvent.setup();
    mockedApi.listTemplates.mockResolvedValue([template]);
    mockedApi.cloneTemplate.mockResolvedValue({ id: "t2" });
    renderPage();
    await screen.findByText("Welcome");
    await user.click(screen.getByLabelText("Duplicate template"));
    await waitFor(() =>
      expect(mockedApi.cloneTemplate).toHaveBeenCalledWith("t1")
    );
  });

  it("deletes a template", async () => {
    const user = userEvent.setup();
    mockedApi.listTemplates.mockResolvedValue([template]);
    mockedApi.deleteTemplate.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText("Welcome");
    await user.click(screen.getByLabelText("Delete template"));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockedApi.deleteTemplate).toHaveBeenCalledWith("t1")
    );
  });

  it("toasts on load failure", async () => {
    mockedApi.listTemplates.mockRejectedValue(new Error("fail"));
    renderPage();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("fail"));
  });
});
