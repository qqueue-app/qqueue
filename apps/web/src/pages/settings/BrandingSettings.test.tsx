import {
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "../../test/render.js";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  message: vi.fn(),
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
    addOrganization: vi.fn(),
  },
}));
vi.mock("../../lib/session-context.js", () => ({
  useSession: () => sessionValue.current,
}));

vi.mock("../../lib/api.js", () => ({
  api: {
    getOrganizationBranding: vi.fn(),
    updateOrganizationBranding: vi.fn(),
    uploadImage: vi.fn(),
  },
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
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionValue.current.currentOrganization = {
    id: "o1",
    name: "Acme",
    role: "OWNER",
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
      footerNote: "Acme Inc, 400 Market St",
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
      brandName: "Acme",
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

  it("says the unsubscribe link cannot be turned off", async () => {
    renderWithProviders(<BrandingSettings />);
    await waitFor(() =>
      expect(
        screen.getByText("An unsubscribe link is always added.")
      ).toBeInTheDocument()
    );
  });

  it("stores the uploaded logo's public URL", async () => {
    mockedApi.uploadImage.mockResolvedValue({
      id: "img_1",
      url: "https://app.test/api/v1/images/pub_1",
      filename: "logo.png",
      contentType: "image/png",
      size: 10,
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
        logoUrl: "https://app.test/api/v1/images/pub_1",
      })
    );
  });

  it("gives a MEMBER no way to save", async () => {
    sessionValue.current.currentOrganization = {
      id: "o1",
      name: "Acme",
      role: "MEMBER",
    };

    renderWithProviders(<BrandingSettings />);

    await waitFor(() => screen.getByLabelText("Brand name"));
    expect(
      screen.queryByRole("button", { name: "Save changes" })
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Brand name")).toBeDisabled();
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
        brandingEnabled: false,
      })
    );
  });

  it("keeps the address and unsubscribe link in the preview when branding is off", async () => {
    mockedApi.getOrganizationBranding.mockResolvedValue({
      ...EMPTY,
      brandName: "Acme",
      footerNote: "Acme Inc, 400 Market St",
      brandingEnabled: false,
    });

    renderWithProviders(<BrandingSettings />);

    // Scoped to the preview: the address also appears in the form field it
    // came from, so an unscoped query matches twice.
    await waitFor(() => screen.getByRole("complementary"));
    const preview = within(screen.getByRole("complementary"));
    expect(preview.getByText("Acme Inc, 400 Market St")).toBeInTheDocument();
    expect(preview.getByText("Unsubscribe")).toBeInTheDocument();
    // The wordmark and copyright are the frame, so they go.
    expect(preview.queryByText("© Acme")).not.toBeInTheDocument();
  });
});
