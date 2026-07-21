import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Thin adapter: these tests pin the HTTP contract (envelope, which args reach
// the service) without re-testing service behaviour.
vi.mock("./service.js", () => ({
  outboxService: { list: vi.fn(), cancel: vi.fn() }
}));

const { outboxController } = await import("./controller.js");
const { outboxService } = await import("./service.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("outboxController", () => {
  it("lists using the org pinned by the membership middleware", async () => {
    const rows = [{ id: "job_1" }];
    vi.mocked(outboxService.list).mockResolvedValue(rows as never);
    const res = mockRes();

    await outboxController.list({ organizationId: "org_1" } as Request, res);

    expect(outboxService.list).toHaveBeenCalledWith("org_1");
    expect(res.json).toHaveBeenCalledWith({ data: rows });
  });

  it("cancels the addressed email within the pinned org", async () => {
    vi.mocked(outboxService.cancel).mockResolvedValue({
      id: "job_1",
      status: "CANCELLED"
    } as never);
    const res = mockRes();

    await outboxController.cancel(
      { params: { id: "job_1" }, organizationId: "org_1" } as unknown as Request,
      res
    );

    // The org id comes from the verified middleware, never from the caller's body.
    expect(outboxService.cancel).toHaveBeenCalledWith("job_1", "org_1");
    expect(res.json).toHaveBeenCalledWith({
      data: { id: "job_1", status: "CANCELLED" }
    });
  });
});
