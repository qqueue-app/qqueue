import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { ApiError } = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError };
});

vi.mock("../lib/api.js", () => ({
  ApiError,
  api: {
    queueOperations: vi.fn(),
    retryQueueJob: vi.fn()
  }
}));

vi.mock("../lib/session-context.js", () => ({
  useSession: () => ({ currentOrganizationId: "org_1" })
}));

import { api } from "../lib/api.js";
import { QueueOperations } from "./QueueOperations.js";

const mockedApi = api as unknown as {
  queueOperations: ReturnType<typeof vi.fn>;
  retryQueueJob: ReturnType<typeof vi.fn>;
};

const queueSummary = [
  {
    name: "email-sending",
    counts: { queued: 1, processing: 1, failed: 1, completed: 3 },
    queuedJobs: [
      {
        id: "queued",
        name: "send-email",
        queueName: "email-sending",
        data: { emailJobId: "email_1" },
        attemptsMade: 0,
        attempts: 3,
        timestamp: "2026-01-01T00:00:00.000Z"
      }
    ],
    processingJobs: [],
    failedJobs: [
      {
        id: "failed",
        name: "send-email",
        queueName: "email-sending",
        data: { emailJobId: "email_2" },
        attemptsMade: 3,
        attempts: 3,
        timestamp: "2026-01-01T00:00:00.000Z",
        failedReason: "SMTP failed"
      }
    ]
  }
];

describe("QueueOperations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.queueOperations.mockResolvedValue(queueSummary);
    mockedApi.retryQueueJob.mockResolvedValue(queueSummary[0].failedJobs[0]);
  });

  it("renders queue counts and jobs", async () => {
    render(<QueueOperations />);

    expect(await screen.findByText("email-sending")).toBeInTheDocument();
    expect(screen.getByText("Queued 1")).toBeInTheDocument();
    expect(screen.getByText("SMTP failed")).toBeInTheDocument();
  });

  it("retries failed jobs", async () => {
    const user = userEvent.setup();
    render(<QueueOperations />);

    await user.click(await screen.findByRole("button", { name: /retry/i }));

    await waitFor(() =>
      expect(mockedApi.retryQueueJob).toHaveBeenCalledWith(
        "email-sending",
        "failed",
        "org_1"
      )
    );
    expect(toast.success).toHaveBeenCalledWith("Job queued for retry.");
  });

  it("shows an access-restricted message on a 403 response", async () => {
    mockedApi.queueOperations.mockRejectedValue(
      new ApiError("You do not have permission to do this", 403)
    );
    render(<QueueOperations />);

    expect(await screen.findByText("Access restricted")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
