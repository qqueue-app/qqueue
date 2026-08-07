import { renderWithProviders, screen, waitFor } from "../../test/render.js";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const invalidateSetupStatus = vi.hoisted(() => vi.fn());
vi.mock("../../lib/setup-status.js", () => ({ invalidateSetupStatus }));

vi.mock("../../lib/api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/api.js")>("../../lib/api.js");
  return {
    ApiError: actual.ApiError,
    api: {
      getInstanceSettings: vi.fn(),
      updateInstanceSettings: vi.fn(),
      instanceEnvStatus: vi.fn(),
    },
  };
});

import { InstanceSettings } from "./InstanceSettings.js";
import { ApiError, api } from "../../lib/api.js";

const envStatus = {
  database: { ok: true },
  redis: { ok: true, host: "localhost", port: 6379 },
  storage: { endpoint: "aws-default", bucket: "qqueue-attachments" },
  secrets: { webhookSecretConfigured: true },
  urls: {
    appUrl: "http://localhost:4000",
    publicAppUrl: "http://localhost:4000",
    webOrigin: null,
  },
  tunables: {
    softBounceThreshold: 5,
    softBounceWindowDays: 7,
    defaultDomainMaxPerMinute: 60,
    attachmentMaxBytes: 10_485_760,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InstanceSettings", () => {
  it("renders settings and configuration health for an admin", async () => {
    vi.mocked(api.getInstanceSettings).mockResolvedValue({
      allowPublicRegistration: true,
      setupCompletedAt: null,
    });
    vi.mocked(api.instanceEnvStatus).mockResolvedValue(envStatus);

    renderWithProviders(<InstanceSettings />);

    expect(
      await screen.findByLabelText("Allow public registration")
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByText("Connected").length).toBeGreaterThan(0)
    );
    expect(screen.getByText("qqueue-attachments")).toBeInTheDocument();
    expect(screen.getByText("10.0 MB")).toBeInTheDocument();
  });

  it("toggles public registration and reports success", async () => {
    vi.mocked(api.getInstanceSettings).mockResolvedValue({
      allowPublicRegistration: true,
      setupCompletedAt: null,
    });
    vi.mocked(api.instanceEnvStatus).mockResolvedValue(envStatus);
    vi.mocked(api.updateInstanceSettings).mockResolvedValue({
      allowPublicRegistration: false,
      setupCompletedAt: null,
    });

    renderWithProviders(<InstanceSettings />);

    await userEvent.click(
      await screen.findByLabelText("Allow public registration")
    );

    await waitFor(() =>
      expect(api.updateInstanceSettings).toHaveBeenCalledWith({
        allowPublicRegistration: false,
      })
    );
    expect(invalidateSetupStatus).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "Registration is now invite only."
    );
  });

  it("surfaces an error when the toggle update fails", async () => {
    vi.mocked(api.getInstanceSettings).mockResolvedValue({
      allowPublicRegistration: true,
      setupCompletedAt: null,
    });
    vi.mocked(api.instanceEnvStatus).mockResolvedValue(envStatus);
    vi.mocked(api.updateInstanceSettings).mockRejectedValue(new Error("boom"));

    renderWithProviders(<InstanceSettings />);

    await userEvent.click(
      await screen.findByLabelText("Allow public registration")
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"));
  });

  it("says who the page is for instead of going blank on a 403", async () => {
    vi.mocked(api.getInstanceSettings).mockRejectedValue(
      new ApiError("Forbidden", 403)
    );

    renderWithProviders(<InstanceSettings />);

    // The hub hides this row, but the URL can still be typed — and a page that
    // renders nothing at all reads as broken.
    expect(
      await screen.findByText("Instance administrators only")
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Allow public registration")
    ).not.toBeInTheDocument();
    expect(api.instanceEnvStatus).not.toHaveBeenCalled();
  });

  it("treats a non-403 failure as no access rather than guessing", async () => {
    vi.mocked(api.getInstanceSettings).mockRejectedValue(
      new Error("network down")
    );

    renderWithProviders(<InstanceSettings />);

    expect(
      await screen.findByText("Instance administrators only")
    ).toBeInTheDocument();
  });
});
