import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent
} from "../../test/render.js";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  message: vi.fn()
}));
vi.mock("sonner", () => ({ toast }));

const sessionValue = vi.hoisted(() => ({
  current: {
    organizations: [{ id: "o1", name: "Acme", role: "OWNER" }],
    currentOrganizationId: "o1",
    currentOrganization: { id: "o1", name: "Acme", role: "OWNER" } as {
      id: string;
      name: string;
      role: string;
    },
    setCurrentOrganizationId: vi.fn(),
    addOrganization: vi.fn()
  }
}));
vi.mock("../../lib/session-context.js", () => ({
  useSession: () => sessionValue.current
}));

vi.mock("../../lib/api.js", () => ({
  api: {
    getOrganizationBranding: vi.fn(),
    updateOrganizationBranding: vi.fn(),
    uploadImage: vi.fn()
  }
}));

import { BrandingSettings } from "./BrandingSettings.js";
import { api } from "../../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const EMPTY = {
  brandName: null,
  logoUrl: null,
  accentColor: null,
  footerNote: null,
  brandingEnabled: true,
  layoutHtml: null
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionValue.current.currentOrganization = {
    id: "o1",
    name: "Acme",
    role: "OWNER"
  };
  mockedApi.getOrganizationBranding.mockResolvedValue(EMPTY);
  mockedApi.updateOrganizationBranding.mockResolvedValue(EMPTY);
});

describe("BrandingSettings", () => {
  it("links back to the hub", async () => {
    renderWithProviders(<BrandingSettings />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
        "href",
        "/settings"
      )
    );
  });

  it("seeds the form from the saved branding", async () => {
    mockedApi.getOrganizationBranding.mockResolvedValue({
      ...EMPTY,
      brandName: "Acme",
      footerNote: "Acme Inc, 400 Market St"
    });

    renderWithProviders(<BrandingSettings />);

    await waitFor(() =>
      expect(screen.getByLabelText("Brand name")).toHaveValue("Acme")
    );
    expect(screen.getByLabelText("Address")).toHaveValue(
      "Acme Inc, 400 Market St"
    );
  });

  it("sends empty fields as null, so clearing one means 'add nothing'", async () => {
    mockedApi.getOrganizationBranding.mockResolvedValue({
      ...EMPTY,
      brandName: "Acme"
    });
    const user = userEvent.setup();
    renderWithProviders(<BrandingSettings />);

    await waitFor(() =>
      expect(screen.getByLabelText("Brand name")).toHaveValue("Acme")
    );
    await user.clear(screen.getByLabelText("Brand name"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockedApi.updateOrganizationBranding).toHaveBeenCalledWith(
        "o1",
        EMPTY
      )
    );
  });

  it("flags a colour that is not six-digit hex", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BrandingSettings />);

    await waitFor(() => screen.getByLabelText("Accent colour"));
    await user.type(screen.getByLabelText("Accent colour"), "green");

    expect(
      screen.getByText("Use a six-digit hex colour, e.g. #2E7D63.")
    ).toBeInTheDocument();
  });

  it("explains campaign unsubscribe defaults", async () => {
    renderWithProviders(<BrandingSettings />);
    await waitFor(() =>
      expect(
        screen.getByText("Campaign unsubscribe links are on by default.")
      ).toBeInTheDocument()
    );
  });

  it("stores the uploaded logo's public URL", async () => {
    mockedApi.uploadImage.mockResolvedValue({
      id: "img_1",
      url: "https://app.test/api/v1/images/pub_1",
      filename: "logo.png",
      contentType: "image/png",
      size: 10
    });
    const user = userEvent.setup();
    renderWithProviders(<BrandingSettings />);

    await waitFor(() => screen.getByLabelText("Brand name"));
    const file = new File(["x"], "logo.png", { type: "image/png" });
    await user.upload(
      document.querySelector("#logo") as HTMLInputElement,
      file
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Remove logo" })).toBeVisible()
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockedApi.updateOrganizationBranding).toHaveBeenCalledWith("o1", {
        ...EMPTY,
        logoUrl: "https://app.test/api/v1/images/pub_1"
      })
    );
  });

  it("gives a MEMBER no way to save", async () => {
    sessionValue.current.currentOrganization = {
      id: "o1",
      name: "Acme",
      role: "MEMBER"
    };

    renderWithProviders(<BrandingSettings />);

    await waitFor(() => screen.getByLabelText("Brand name"));
    expect(
      screen.queryByRole("button", { name: "Save changes" })
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Brand name")).toBeDisabled();
    expect(
      screen.getByRole("textbox", { name: "Email branding" })
    ).toHaveAttribute("contenteditable", "false");
    expect(
      screen.getByRole("button", { name: "Bold", exact: true })
    ).toBeDisabled();
  });

  it("saves the branding switch when it is turned off", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BrandingSettings />);

    await waitFor(() => screen.getByRole("switch"));
    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockedApi.updateOrganizationBranding).toHaveBeenCalledWith("o1", {
        ...EMPTY,
        brandingEnabled: false
      })
    );
  });

  it("keeps the address and unsubscribe link in the preview when branding is off", async () => {
    mockedApi.getOrganizationBranding.mockResolvedValue({
      ...EMPTY,
      brandName: "Acme",
      footerNote: "Acme Inc, 400 Market St",
      brandingEnabled: false
    });

    renderWithProviders(<BrandingSettings />);

    await waitFor(() => screen.getByTitle("Branding preview"));
    const preview = screen.getByTitle("Branding preview");
    expect(preview.getAttribute("srcdoc")).toContain("Acme Inc, 400 Market St");
    expect(preview.getAttribute("srcdoc")).toContain("Unsubscribe");
    expect(preview.getAttribute("srcdoc")).not.toContain("© Acme");
  });
});

it("keeps the existing logo and fields when exposing HTML without opting into a new layout", async () => {
  mockedApi.getOrganizationBranding.mockResolvedValue({
    ...EMPTY,
    brandName: "Acme",
    logoUrl: "https://example.com/logo.png",
    accentColor: "#123456",
    footerNote: "Old address"
  });
  const user = userEvent.setup();
  renderWithProviders(<BrandingSettings />);
  await waitFor(() =>
    expect(screen.getByLabelText("Brand name")).toHaveValue("Acme")
  );
  expect(
    (screen.getByLabelText("Branding HTML") as HTMLTextAreaElement).value
  ).toContain("{{logo_url}}");
  const frame = screen.getByTitle("Branding preview");
  expect(frame).toHaveAttribute("sandbox", "");
  expect(frame.getAttribute("srcdoc")).toContain(
    "https://example.com/logo.png"
  );
  expect(frame.getAttribute("srcdoc")).toContain("Old address");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mockedApi.updateOrganizationBranding).toHaveBeenCalledWith(
      "o1",
      expect.objectContaining({
        layoutHtml: null,
        logoUrl: "https://example.com/logo.png"
      })
    )
  );
});

it("previews pasted HTML and saves it exactly", async () => {
  const user = userEvent.setup();
  renderWithProviders(<BrandingSettings />);
  await screen.findByLabelText("Branding HTML");
  const html =
    "<html><body><header>Our custom design</header><main>{{content}}</main><footer>{{footer_note}}</footer></body></html>";
  fireEvent.change(screen.getByLabelText("Branding HTML"), {
    target: { value: html }
  });
  expect(
    screen.getByTitle("Branding preview").getAttribute("srcdoc")
  ).toContain("Our custom design");
  expect(
    screen.getByTitle("Branding preview").getAttribute("srcdoc")
  ).toContain("Spring release is live");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mockedApi.updateOrganizationBranding).toHaveBeenCalledWith("o1", {
      ...EMPTY,
      layoutHtml: html
    })
  );
});

it("keeps saved HTML and asks before replacing it with a starter", async () => {
  const original =
    "<html><body><header>Saved</header>{{content}}</body></html>";
  mockedApi.getOrganizationBranding.mockResolvedValue({
    ...EMPTY,
    brandName: "Acme",
    layoutHtml: original
  });
  const user = userEvent.setup();
  renderWithProviders(<BrandingSettings />);
  await waitFor(() =>
    expect(screen.getByLabelText("Branding HTML")).toHaveValue(original)
  );
  await user.click(screen.getByRole("button", { name: "Use card" }));
  expect(screen.getByLabelText("Branding HTML")).toHaveValue(original);
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Branding HTML")).toHaveValue(original);
  await user.click(screen.getByRole("button", { name: "Use accent header" }));
  await user.click(screen.getByRole("button", { name: "Replace layout" }));
  expect(
    (screen.getByLabelText("Branding HTML") as HTMLTextAreaElement).value
  ).toContain("border-top:6px");
  expect(screen.getByLabelText("Brand name")).toHaveValue("Acme");
  expect(mockedApi.updateOrganizationBranding).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Use original layout" }));
  await user.click(screen.getByRole("button", { name: "Replace layout" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mockedApi.updateOrganizationBranding).toHaveBeenCalledWith(
      "o1",
      expect.objectContaining({ layoutHtml: null, brandName: "Acme" })
    )
  );
});

it("requires a single content slot before saving", async () => {
  renderWithProviders(<BrandingSettings />);
  await screen.findByLabelText("Branding HTML");
  fireEvent.change(screen.getByLabelText("Branding HTML"), {
    target: { value: "<p>No email body</p>" }
  });
  expect(screen.getByRole("alert")).toHaveTextContent("exactly once");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

it("opens in rich text with existing branding and saves visual edits", async () => {
  mockedApi.getOrganizationBranding.mockResolvedValue({
    ...EMPTY,
    brandName: "Acme",
    footerNote: "Existing address"
  });
  const user = userEvent.setup();
  renderWithProviders(<BrandingSettings />);
  const editor = await screen.findByRole("textbox", { name: "Email branding" });
  await waitFor(() => expect(editor).toHaveTextContent("Acme"));
  expect(editor).toHaveTextContent("Existing address");
  expect(editor.querySelector("[data-qq-raw]")).toBeNull();
  expect(
    screen.getByLabelText("Branding HTML").closest("details")
  ).not.toHaveAttribute("open");
  await user.click(editor);
  await user.click(screen.getByRole("button", { name: "Bold", exact: true }));
  await user.keyboard("Brand update");
  await waitFor(() => expect(editor).toHaveTextContent("Brand update"));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mockedApi.updateOrganizationBranding).toHaveBeenCalledWith(
      "o1",
      expect.objectContaining({
        brandName: "Acme",
        layoutHtml: expect.stringContaining("Brand update")
      })
    )
  );
  expect(
    screen.getByTitle("Branding preview").getAttribute("srcdoc")
  ).toContain("Brand update");
});

it("inserts an uploaded image from the rich text toolbar without saving the page", async () => {
  const user = userEvent.setup();
  mockedApi.uploadImage.mockResolvedValue({
    url: "https://example.com/banner.png"
  });
  renderWithProviders(<BrandingSettings />);
  await screen.findByRole("textbox", { name: "Email branding" });
  await user.click(screen.getByRole("button", { name: "Image", exact: true }));
  const file = new File(["image"], "banner.png", { type: "image/png" });
  await user.upload(screen.getByLabelText("Upload image"), file);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  );
  expect(mockedApi.uploadImage).toHaveBeenCalledWith(file, {
    organizationId: "o1"
  });
  expect(
    screen
      .getByRole("textbox", { name: "Email branding" })
      .querySelector('img[src="https://example.com/banner.png"]')
  ).not.toBeNull();
  expect(mockedApi.updateOrganizationBranding).not.toHaveBeenCalled();
});

it("shows live starter thumbnails without replacing the current design", async () => {
  const original = "<html><body><p>Keep my design</p>{{content}}</body></html>";
  mockedApi.getOrganizationBranding.mockResolvedValue({
    ...EMPTY,
    brandName: "Acme",
    logoUrl: "https://example.com/logo.png",
    accentColor: "#123456",
    layoutHtml: original
  });
  const user = userEvent.setup();
  renderWithProviders(<BrandingSettings />);
  await waitFor(() =>
    expect(screen.getByLabelText("Brand name")).toHaveValue("Acme")
  );
  for (const name of ["Current branding", "Accent header", "Card"]) {
    const thumbnail = screen.getByTitle(`${name} design preview`);
    expect(thumbnail).toHaveAttribute("sandbox", "");
    expect(thumbnail).toHaveAttribute("tabindex", "-1");
    expect(thumbnail).toHaveAttribute("aria-hidden", "true");
    expect(thumbnail.getAttribute("srcdoc")).toContain(
      "https://example.com/logo.png"
    );
    expect(thumbnail.getAttribute("srcdoc")).toContain(
      "Spring release is live"
    );
    expect(thumbnail.getAttribute("srcdoc")).toContain("Acme");
  }
  expect(
    screen.getByTitle("Accent header design preview").getAttribute("srcdoc")
  ).toContain("border-top:6px solid #123456");
  expect(
    screen.getByTitle("Card design preview").getAttribute("srcdoc")
  ).toContain("background:#f0f4f8");
  await user.clear(screen.getByLabelText("Accent colour"));
  await user.type(screen.getByLabelText("Accent colour"), "#654321");
  expect(
    screen.getByTitle("Accent header design preview").getAttribute("srcdoc")
  ).toContain("border-top:6px solid #654321");
  expect(screen.getByLabelText("Branding HTML")).toHaveValue(original);
  expect(mockedApi.updateOrganizationBranding).not.toHaveBeenCalled();
});
