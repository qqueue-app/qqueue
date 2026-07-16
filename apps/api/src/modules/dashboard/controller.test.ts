import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  dashboardService: { summary: vi.fn() }
}));

const { dashboardController } = await import("./controller.js");
const { dashboardService } = await import("./service.js");

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

describe("dashboardController.summary", () => {
  it("summarises the org pinned by requireOrgMembership", async () => {
    const summary = { totals: { sent: 10 } };
    vi.mocked(dashboardService.summary).mockResolvedValue(summary as never);
    const res = mockRes();

    await dashboardController.summary({ organizationId: "org_1" } as Request, res);

    expect(dashboardService.summary).toHaveBeenCalledWith("org_1");
    expect(res.json).toHaveBeenCalledWith({ data: summary });
  });

  it("propagates a service failure instead of shaping a response", async () => {
    vi.mocked(dashboardService.summary).mockRejectedValue(new Error("db down"));
    const res = mockRes();

    await expect(
      dashboardController.summary({ organizationId: "org_1" } as Request, res)
    ).rejects.toThrow("db down");
    expect(res.json).not.toHaveBeenCalled();
  });
});
