import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  domainThrottleService: {
    list: vi.fn(),
    defaultPerMinute: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn()
  }
}));

const { domainThrottleController } = await import("./controller.js");
const { domainThrottleService } = await import("./service.js");

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

describe("domainThrottleController.list", () => {
  it("returns the org's rows alongside DEFAULT_DOMAIN_MAX_PER_MINUTE", async () => {
    const throttles = [{ id: "thr_1", domain: "example.com", maxPerMinute: 60 }];
    vi.mocked(domainThrottleService.list).mockResolvedValue(throttles as never);
    vi.mocked(domainThrottleService.defaultPerMinute).mockReturnValue(120 as never);
    const res = mockRes();

    await domainThrottleController.list({ organizationId: "org_1" } as Request, res);

    expect(domainThrottleService.list).toHaveBeenCalledWith("org_1");
    expect(res.json).toHaveBeenCalledWith({
      data: { throttles, defaultPerMinute: 120 }
    });
  });
});

describe("domainThrottleController.upsert", () => {
  it("upserts a validated throttle row", async () => {
    const throttle = { id: "thr_1", domain: "example.com", maxPerMinute: 60 };
    vi.mocked(domainThrottleService.upsert).mockResolvedValue(throttle as never);
    const res = mockRes();

    await domainThrottleController.upsert(
      {
        body: { organizationId: "org_1", domain: "Example.COM", maxPerMinute: "60" }
      } as unknown as Request,
      res
    );

    // The schema lowercases/trims the domain and coerces maxPerMinute to a number.
    expect(domainThrottleService.upsert).toHaveBeenCalledWith({
      organizationId: "org_1",
      domain: "example.com",
      maxPerMinute: 60
    });
    expect(res.json).toHaveBeenCalledWith({ data: throttle });
  });

  it("defaults an omitted domain to \"\", the org-wide default row", async () => {
    vi.mocked(domainThrottleService.upsert).mockResolvedValue({} as never);

    await domainThrottleController.upsert(
      { body: { organizationId: "org_1", maxPerMinute: 10 } } as unknown as Request,
      mockRes()
    );

    expect(domainThrottleService.upsert).toHaveBeenCalledWith({
      organizationId: "org_1",
      domain: "",
      maxPerMinute: 10
    });
  });

  it("rejects an invalid body before reaching the service", async () => {
    await expect(
      domainThrottleController.upsert(
        { body: { organizationId: "org_1", domain: "not a domain", maxPerMinute: 0 } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(domainThrottleService.upsert).not.toHaveBeenCalled();
  });
});

describe("domainThrottleController.remove", () => {
  it("removes by id and responds 204 with no body", async () => {
    vi.mocked(domainThrottleService.remove).mockResolvedValue(undefined as never);
    const res = mockRes();

    await domainThrottleController.remove(
      { params: { id: "thr_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(domainThrottleService.remove).toHaveBeenCalledWith("thr_1", "usr_1");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it("propagates a service not-found error without responding", async () => {
    vi.mocked(domainThrottleService.remove).mockRejectedValue(new Error("not found"));
    const res = mockRes();

    await expect(
      domainThrottleController.remove(
        { params: { id: "missing" }, userId: "usr_1" } as unknown as Request,
        res
      )
    ).rejects.toThrow("not found");
    expect(res.status).not.toHaveBeenCalled();
  });
});
