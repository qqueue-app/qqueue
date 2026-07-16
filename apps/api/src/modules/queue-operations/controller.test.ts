import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts. The
// OWNER/ADMIN gate lives in middleware, so it is out of scope here.
vi.mock("./service.js", () => ({
  queueOperationsService: {
    summary: vi.fn(),
    retry: vi.fn()
  }
}));

const { queueOperationsController } = await import("./controller.js");
const { queueOperationsService } = await import("./service.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("queueOperationsController.summary", () => {
  it("returns the queue summary; the dashboard is instance-wide, not org-scoped", async () => {
    const queues = [{ name: "email-sending", counts: { waiting: 2 } }];
    vi.mocked(queueOperationsService.summary).mockResolvedValue(queues as never);
    const res = mockRes();

    await queueOperationsController.summary({} as Request, res);

    expect(queueOperationsService.summary).toHaveBeenCalledWith();
    expect(res.json).toHaveBeenCalledWith({ data: queues });
  });
});

describe("queueOperationsController.retry", () => {
  it("retries the addressed job from the route params", async () => {
    const job = { id: "job_1" };
    vi.mocked(queueOperationsService.retry).mockResolvedValue(job as never);
    const res = mockRes();

    await queueOperationsController.retry(
      { params: { queueName: "email-sending", jobId: "job_1" } } as unknown as Request,
      res
    );

    expect(queueOperationsService.retry).toHaveBeenCalledWith("email-sending", "job_1");
    expect(res.json).toHaveBeenCalledWith({ data: job });
  });

  it("propagates an unknown queue/job error without responding", async () => {
    vi.mocked(queueOperationsService.retry).mockRejectedValue(new Error("Job not found"));
    const res = mockRes();

    await expect(
      queueOperationsController.retry(
        { params: { queueName: "email-sending", jobId: "missing" } } as unknown as Request,
        res
      )
    ).rejects.toThrow("Job not found");
    expect(res.json).not.toHaveBeenCalled();
  });
});
