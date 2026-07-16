import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  setupService: {
    status: vi.fn(),
    complete: vi.fn()
  }
}));

const { setupController } = await import("./controller.js");
const { setupService } = await import("./service.js");

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

describe("setupController.status", () => {
  it("returns the first-run probe consumed by SetupGate", async () => {
    // The probe is public and unauthenticated: no req fields are read.
    const status = { needsSetup: true, hasUsers: false };
    vi.mocked(setupService.status).mockResolvedValue(status as never);
    const res = mockRes();

    await setupController.status({} as Request, res);

    expect(setupService.status).toHaveBeenCalledWith();
    expect(res.json).toHaveBeenCalledWith({ data: status });
  });
});

describe("setupController.complete", () => {
  it("records the wizard's registration choice for the caller and responds 201", async () => {
    const result = { setupCompletedAt: "2026-01-01T00:00:00.000Z" };
    vi.mocked(setupService.complete).mockResolvedValue(result as never);
    const res = mockRes();

    await setupController.complete(
      { body: { allowPublicRegistration: false }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(setupService.complete).toHaveBeenCalledWith("usr_1", {
      allowPublicRegistration: false
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("rejects a body missing allowPublicRegistration before reaching the service", async () => {
    await expect(
      setupController.complete({ body: {}, userId: "usr_1" } as unknown as Request, mockRes())
    ).rejects.toThrow();
    expect(setupService.complete).not.toHaveBeenCalled();
  });
});
