import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const invalidateSetupStatus = vi.hoisted(() => vi.fn());
vi.mock("../lib/setup-status.js", () => ({ invalidateSetupStatus }));

vi.mock("../lib/api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/api.js")>("../lib/api.js");
  return {
    ApiError: actual.ApiError,
    api: {
      getInstanceSettings: vi.fn(),
      updateInstanceSettings: vi.fn(),
      instanceEnvStatus: vi.fn()
    }
  };
});

import { InstanceSettingsCard } from "./InstanceSettingsCard.js";
import { ApiError, api } from "../lib/api.js";

const envStatus = {
  database: { ok: true },
  redis: { ok: true, host: "localhost", port: 6379 },
  storage: { endpoint: "aws-default", bucket: "qqueue-attachments" },
  secrets: { webhookSecretConfigured: true },
  urls: {
    appUrl: "http://localhost:4000",
    publicAppUrl: "http://localhost:4000",
    webOrigin: null
  },
  tunables: {
    softBounceThreshold: 5,
    softBounceWindowDays: 7,
    defaultDomainMaxPerMinute: 60,
    attachmentMaxBytes: 10_485_760
  }
};

beforeEach(() => {
  vi.mocked(api.getInstanceSettings).mockReset();
  vi.mocked(api.updateInstanceSettings).mockReset();
  vi.mocked(api.instanceEnvStatus).mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  invalidateSetupStatus.mockReset();
});

describe("InstanceSettingsCard", () => {
  it("renders settings and configuration health for an admin", async () => {
    vi.mocked(api.getInstanceSettings).mockResolvedValue({
      allowPublicRegistration: true,
      setupCompletedAt: null
    });
    vi.mocked(api.instanceEnvStatus).mockResolvedValue(envStatus);

    render(<InstanceSettingsCard />);

    expect(await screen.findByText("Instance")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Allow public registration")
    ).toBeInTheDocument();
    // env-status renders once instanceEnvStatus resolves
    await waitFor(() =>
      expect(screen.getAllByText("Connected").length).toBeGreaterThan(0)
    );
    expect(screen.getByText("qqueue-attachments")).toBeInTheDocument();
    // formatBytes: 10,485,760 bytes -> "10 MB"
    expect(screen.getByText("10 MB")).toBeInTheDocument();
  });

  it("toggles public registration and reports success", async () => {
    vi.mocked(api.getInstanceSettings).mockResolvedValue({
      allowPublicRegistration: true,
      setupCompletedAt: null
    });
    vi.mocked(api.instanceEnvStatus).mockResolvedValue(envStatus);
    vi.mocked(api.updateInstanceSettings).mockResolvedValue({
      allowPublicRegistration: false,
      setupCompletedAt: null
    });

    render(<InstanceSettingsCard />);

    const toggle = await screen.findByLabelText("Allow public registration");
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(api.updateInstanceSettings).toHaveBeenCalledWith({
        allowPublicRegistration: false
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
      setupCompletedAt: null
    });
    vi.mocked(api.instanceEnvStatus).mockResolvedValue(envStatus);
    vi.mocked(api.updateInstanceSettings).mockRejectedValue(
      new Error("boom")
    );

    render(<InstanceSettingsCard />);

    const toggle = await screen.findByLabelText("Allow public registration");
    await userEvent.click(toggle);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"));
  });

  it("renders nothing for a non-admin (403)", async () => {
    vi.mocked(api.getInstanceSettings).mockRejectedValue(
      new ApiError("Forbidden", 403)
    );

    const { container } = render(<InstanceSettingsCard />);

    // Give the rejected effect a chance to run, then assert the card is absent.
    await waitFor(() => expect(api.getInstanceSettings).toHaveBeenCalled());
    expect(screen.queryByText("Instance")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the card but toasts on a non-403 load failure", async () => {
    vi.mocked(api.getInstanceSettings).mockRejectedValue(
      new Error("network down")
    );

    render(<InstanceSettingsCard />);

    expect(await screen.findByText("Instance")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("network down");
  });
});
