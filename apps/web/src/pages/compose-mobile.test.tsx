import { renderWithProviders, screen } from "../test/render.js";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Force the mobile branch of `useIsMobile`. The shared setup stubs matchMedia
 * to match nothing, which is what makes every other page test render desktop.
 */
function useMobileViewport() {
  const original = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("max-width: 639.98px"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const session = vi.hoisted(() => ({
  current: { currentOrganizationId: "org_1" },
}));
vi.mock("../lib/session-context.js", () => ({
  useSession: () => session.current,
}));

vi.mock("../lib/api.js", () => ({
  api: {
    listTemplates: vi.fn(),
    listSendableSMTPConnections: vi.fn(),
    listContacts: vi.fn(),
    listContactLists: vi.fn(),
    listEmailDrafts: vi.fn(),
    listRecipientSuggestions: vi.fn(),
    listRecurringSends: vi.fn(),
    pauseRecurringSend: vi.fn(),
    resumeRecurringSend: vi.fn(),
    deleteRecurringSend: vi.fn(),
    createEmailDraft: vi.fn(),
    updateEmailDraft: vi.fn(),
  },
}));

vi.mock("../components/editor/RichTextEditor.js", () => ({
  RichTextEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (html: string) => void;
  }) => (
    <textarea
      aria-label="body-editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

import { EmailStudio } from "./EmailStudio.js";
import { RecurringSends } from "./RecurringSends.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

let restore: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  restore = useMobileViewport();
  mockedApi.listTemplates.mockResolvedValue([]);
  mockedApi.listSendableSMTPConnections.mockResolvedValue([
    {
      id: "s1",
      organizationId: "org_1",
      name: "Primary",
      host: "smtp.x",
      port: 587,
      secure: false,
      fromEmail: "from@x.com",
      isDefault: true,
    },
  ]);
  mockedApi.listContacts.mockResolvedValue([]);
  mockedApi.listContactLists.mockResolvedValue([]);
  mockedApi.listEmailDrafts.mockResolvedValue([]);
  mockedApi.listRecipientSuggestions.mockResolvedValue([]);
  mockedApi.listRecurringSends.mockResolvedValue([
    {
      id: "rs_1",
      organizationId: "org_1",
      name: "Weekly digest",
      subject: "This week at Acme",
      cronExpression: "0 9 * * 1",
      timezone: "Europe/London",
      status: "ACTIVE",
      nextRunAt: "2026-08-10T08:00:00.000Z",
      lastRunAt: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    },
  ]);
});

afterEach(() => restore());

async function renderCompose() {
  const result = renderWithProviders(
    <MemoryRouter>
      <EmailStudio />
    </MemoryRouter>,
    { withRouter: false }
  );
  await screen.findByRole("button", { name: /Send email/i });
  return result;
}

describe("Compose on a phone", () => {
  /*
    The mobile inversion (§2): below 480px the anti-stretch rule flips and a
    field fills the padded column, because on a phone the column IS the
    content width. Every field therefore carries both halves — `w-full` and
    the `xs:` width it takes once there is room for it.
  */
  it("gives every field the padded column's full width, and its own above it", async () => {
    await renderCompose();

    expect(screen.getByRole("combobox", { name: "From" }).className).toContain(
      "w-full xs:w-field-name"
    );
    expect(screen.getByLabelText("Subject").className).toContain(
      "w-full xs:w-field-long"
    );
    // The To chip box is a field like any other and sizes the same way — the
    // width sits on the wrapper the label shares with it.
    expect(screen.getByText("To").parentElement?.className).toContain(
      "w-full xs:w-field-long"
    );
  });

  it("keeps the recipient box tappable and typing zoom-free", async () => {
    await renderCompose();
    const input = screen.getByLabelText("To");

    // iOS zooms the viewport when a focused field's text is under 16px, and
    // this app installs to home screens.
    expect(input.className).toContain("text-base");
    expect(input.className).toContain("sm:text-body");
    // 44px tall on touch, back to the 36px control height from `sm` up.
    expect(input.parentElement?.className).toContain("min-h-touch");
    expect(input.parentElement?.className).toContain("sm:min-h-control");
  });

  it("gives a recipient chip's remove button a 44px hit area", async () => {
    const user = userEvent.setup();
    await renderCompose();

    await user.type(screen.getByLabelText("To"), "rcpt@x.com{Enter}");
    const remove = screen.getByLabelText("Remove rcpt@x.com");

    // The chip keeps its size; the tap target is an invisible pseudo-element,
    // dropped again from `sm` up.
    expect(remove.className).toContain("after:h-touch");
    expect(remove.className).toContain("after:w-touch");
    expect(remove.className).toContain("sm:after:hidden");
  });

  it("still folds Cc, Bcc and attachments away on the narrowest screen", async () => {
    const user = userEvent.setup();
    await renderCompose();

    expect(screen.queryByLabelText("Cc")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add files/i })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cc / Bcc" }));
    expect(screen.getByLabelText("Cc")).toBeInTheDocument();
  });
});

describe("Recurring sends on a phone", () => {
  it("renders each schedule as a stacked card, never a table", async () => {
    renderWithProviders(
      <MemoryRouter>
        <RecurringSends />
      </MemoryRouter>,
      { withRouter: false }
    );
    await screen.findByText("Weekly digest");

    // §5: tables don't shrink, they transform. The <table> must not exist at
    // all — hiding it would leave every row in the accessibility tree twice.
    expect(
      screen.queryByRole("table", { name: "Recurring sends" })
    ).not.toBeInTheDocument();

    // The row's content survives the transform.
    expect(screen.getByText(/At 09:00 AM, only on Monday/i)).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Europe/London")).toBeInTheDocument();
  });

  it("keeps both row actions reachable by tap, not hover", async () => {
    renderWithProviders(
      <MemoryRouter>
        <RecurringSends />
      </MemoryRouter>,
      { withRouter: false }
    );
    await screen.findByText("Weekly digest");

    expect(
      screen.getByRole("button", { name: /Pause this schedule/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /More actions for Weekly digest/i })
    ).toBeInTheDocument();
  });
});
