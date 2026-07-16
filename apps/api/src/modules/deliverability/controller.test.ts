import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  deliverabilityService: {
    overview: vi.fn(),
    domains: vi.fn(),
    alerts: vi.fn()
  }
}));

const { deliverabilityController } = await import("./controller.js");
const { deliverabilityService } = await import("./service.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

const FROM = "2026-01-01T00:00:00.000Z";
const TO = "2026-02-01T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deliverabilityController.overview", () => {
  it("passes the org and the ISO window through to the service", async () => {
    const data = { sent: 100, bounceRate: 0.01 };
    vi.mocked(deliverabilityService.overview).mockResolvedValue(data as never);
    const res = mockRes();

    await deliverabilityController.overview(
      { organizationId: "org_1", query: { from: FROM, to: TO } } as unknown as Request,
      res
    );

    expect(deliverabilityService.overview).toHaveBeenCalledWith({
      organizationId: "org_1",
      from: FROM,
      to: TO
    });
    expect(res.json).toHaveBeenCalledWith({ data });
  });

  it("omits non-string from/to so the service applies its default window", async () => {
    vi.mocked(deliverabilityService.overview).mockResolvedValue({} as never);
    const res = mockRes();

    await deliverabilityController.overview(
      // Express parses repeated query params into arrays; those are not dates.
      { organizationId: "org_1", query: { from: [FROM] } } as unknown as Request,
      res
    );

    expect(deliverabilityService.overview).toHaveBeenCalledWith({
      organizationId: "org_1",
      from: undefined,
      to: undefined
    });
  });

  it("rejects a non-ISO datetime before reaching the service", async () => {
    await expect(
      deliverabilityController.overview(
        { organizationId: "org_1", query: { from: "yesterday" } } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(deliverabilityService.overview).not.toHaveBeenCalled();
  });
});

describe("deliverabilityController.domains", () => {
  it("returns the per-domain breakdown", async () => {
    const data = [{ domain: "example.com", sent: 5 }];
    vi.mocked(deliverabilityService.domains).mockResolvedValue(data as never);
    const res = mockRes();

    await deliverabilityController.domains(
      { organizationId: "org_1", query: {} } as unknown as Request,
      res
    );

    expect(deliverabilityService.domains).toHaveBeenCalledWith({
      organizationId: "org_1",
      from: undefined,
      to: undefined
    });
    expect(res.json).toHaveBeenCalledWith({ data });
  });

  it("rejects an invalid window before reaching the service", async () => {
    await expect(
      deliverabilityController.domains(
        { organizationId: "org_1", query: { to: "soon" } } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(deliverabilityService.domains).not.toHaveBeenCalled();
  });
});

describe("deliverabilityController.alerts", () => {
  it("returns reputation alerts for the window", async () => {
    const data = [{ severity: "warning" }];
    vi.mocked(deliverabilityService.alerts).mockResolvedValue(data as never);
    const res = mockRes();

    await deliverabilityController.alerts(
      { organizationId: "org_1", query: { from: FROM, to: TO } } as unknown as Request,
      res
    );

    expect(deliverabilityService.alerts).toHaveBeenCalledWith({
      organizationId: "org_1",
      from: FROM,
      to: TO
    });
    expect(res.json).toHaveBeenCalledWith({ data });
  });

  it("rejects an invalid window before reaching the service", async () => {
    await expect(
      deliverabilityController.alerts(
        { organizationId: "org_1", query: { from: "nope" } } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(deliverabilityService.alerts).not.toHaveBeenCalled();
  });
});
