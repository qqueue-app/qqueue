import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts. The
// isInstanceAdmin gate lives in middleware, so it is out of scope here.
vi.mock("./service.js", () => ({
  instanceSettingsService: {
    get: vi.fn(),
    update: vi.fn(),
    envStatus: vi.fn()
  }
}));

const { instanceSettingsController } = await import("./controller.js");
const { instanceSettingsService } = await import("./service.js");

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

describe("instanceSettingsController.get", () => {
  it("returns the resolved instance settings", async () => {
    const settings = { allowPublicRegistration: false };
    vi.mocked(instanceSettingsService.get).mockResolvedValue(settings as never);
    const res = mockRes();

    await instanceSettingsController.get({} as Request, res);

    expect(instanceSettingsService.get).toHaveBeenCalledWith();
    expect(res.json).toHaveBeenCalledWith({ data: settings });
  });
});

describe("instanceSettingsController.update", () => {
  it("updates the validated settings", async () => {
    const settings = { allowPublicRegistration: true };
    vi.mocked(instanceSettingsService.update).mockResolvedValue(settings as never);
    const res = mockRes();

    await instanceSettingsController.update({ body: settings } as Request, res);

    expect(instanceSettingsService.update).toHaveBeenCalledWith({
      allowPublicRegistration: true
    });
    expect(res.json).toHaveBeenCalledWith({ data: settings });
  });

  it("accepts an empty body — every key in the update schema is optional", async () => {
    vi.mocked(instanceSettingsService.update).mockResolvedValue({} as never);

    await instanceSettingsController.update({ body: {} } as Request, mockRes());

    expect(instanceSettingsService.update).toHaveBeenCalledWith({});
  });

  it("rejects a non-boolean allowPublicRegistration before reaching the service", async () => {
    await expect(
      instanceSettingsController.update(
        { body: { allowPublicRegistration: "yes" } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(instanceSettingsService.update).not.toHaveBeenCalled();
  });
});

describe("instanceSettingsController.envStatus", () => {
  it("returns the env health view", async () => {
    const status = { database: "ok", redis: "ok" };
    vi.mocked(instanceSettingsService.envStatus).mockResolvedValue(status as never);
    const res = mockRes();

    await instanceSettingsController.envStatus({} as Request, res);

    expect(instanceSettingsService.envStatus).toHaveBeenCalledWith();
    expect(res.json).toHaveBeenCalledWith({ data: status });
  });
});
