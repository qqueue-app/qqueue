import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  suppressionService: {
    list: vi.fn(),
    addSuppression: vi.fn(),
    remove: vi.fn(),
    getEffectivePolicy: vi.fn(),
    upsertPolicy: vi.fn()
  }
}));

const { suppressionController } = await import("./controller.js");
const { suppressionService } = await import("./service.js");

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

describe("suppressionController.list", () => {
  it("lists suppressions for the org pinned by requireOrgMembership", async () => {
    const rows = [{ id: "sup_1" }];
    vi.mocked(suppressionService.list).mockResolvedValue(rows as never);
    const res = mockRes();

    await suppressionController.list({ organizationId: "org_1" } as Request, res);

    expect(suppressionService.list).toHaveBeenCalledWith("org_1");
    expect(res.json).toHaveBeenCalledWith({ data: rows });
  });
});

describe("suppressionController.create", () => {
  it("creates a manual suppression and responds 201", async () => {
    const created = { id: "sup_1" };
    vi.mocked(suppressionService.addSuppression).mockResolvedValue(created as never);
    const res = mockRes();

    await suppressionController.create(
      {
        body: {
          organizationId: "org_1",
          email: "blocked@example.com",
          reason: "MANUAL"
        }
      } as Request,
      res
    );

    // Manual adds are always tagged source: "manual" by the controller.
    expect(suppressionService.addSuppression).toHaveBeenCalledWith({
      organizationId: "org_1",
      email: "blocked@example.com",
      reason: "MANUAL",
      source: "manual"
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: created });
  });

  it("rejects an invalid body before reaching the service", async () => {
    await expect(
      suppressionController.create({ body: { email: "not-an-email" } } as Request, mockRes())
    ).rejects.toThrow();
    expect(suppressionService.addSuppression).not.toHaveBeenCalled();
  });
});

describe("suppressionController.remove", () => {
  it("removes by id and responds 204 with no body", async () => {
    vi.mocked(suppressionService.remove).mockResolvedValue(undefined as never);
    const res = mockRes();

    await suppressionController.remove(
      { params: { id: "sup_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(suppressionService.remove).toHaveBeenCalledWith("sup_1", "usr_1");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});

describe("suppressionController.getPolicy", () => {
  it("returns the effective policy for the org", async () => {
    const policy = { hardBounceSuppress: true };
    vi.mocked(suppressionService.getEffectivePolicy).mockResolvedValue(policy as never);
    const res = mockRes();

    await suppressionController.getPolicy({ organizationId: "org_1" } as Request, res);

    expect(suppressionService.getEffectivePolicy).toHaveBeenCalledWith("org_1");
    expect(res.json).toHaveBeenCalledWith({ data: policy });
  });
});

describe("suppressionController.updatePolicy", () => {
  it("upserts the validated policy", async () => {
    const policy = {
      organizationId: "org_1",
      softBounceThreshold: 3,
      softBounceWindowDays: 30
    };
    vi.mocked(suppressionService.upsertPolicy).mockResolvedValue(policy as never);
    const res = mockRes();

    await suppressionController.updatePolicy({ body: policy } as Request, res);

    expect(suppressionService.upsertPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1" })
    );
    expect(res.json).toHaveBeenCalledWith({ data: policy });
  });

  it("rejects an invalid policy body", async () => {
    await expect(
      suppressionController.updatePolicy({ body: {} } as Request, mockRes())
    ).rejects.toThrow();
    expect(suppressionService.upsertPolicy).not.toHaveBeenCalled();
  });
});
