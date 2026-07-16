import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  segmentService: {
    list: vi.fn(),
    create: vi.fn(),
    preview: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    remove: vi.fn()
  }
}));

const { segmentController } = await import("./controller.js");
const { segmentService } = await import("./service.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

// A nested rule tree: segments are dynamic, so the tree is the payload that
// matters — it is stored verbatim and resolved against contacts at send time.
const rules = {
  op: "AND" as const,
  rules: [
    { field: "status" as const, eq: "ACTIVE" as const },
    { field: "tags" as const, match: "ANY" as const, values: ["vip"] }
  ]
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("segmentController.list", () => {
  it("lists segments for the org pinned by requireOrgMembership", async () => {
    const rows = [{ id: "seg_1" }];
    vi.mocked(segmentService.list).mockResolvedValue(rows as never);
    const res = mockRes();

    await segmentController.list({ organizationId: "org_1" } as Request, res);

    expect(segmentService.list).toHaveBeenCalledWith("org_1");
    expect(res.json).toHaveBeenCalledWith({ data: rows });
  });
});

describe("segmentController.create", () => {
  it("creates a segment from a validated rule tree and responds 201", async () => {
    const created = { id: "seg_1" };
    vi.mocked(segmentService.create).mockResolvedValue(created as never);
    const res = mockRes();

    await segmentController.create(
      {
        body: {
          organizationId: "org_1",
          name: "Active VIPs",
          description: "Engaged customers",
          rules
        }
      } as Request,
      res
    );

    // The rule tree must reach the service unflattened — it is the segment.
    expect(segmentService.create).toHaveBeenCalledWith({
      organizationId: "org_1",
      name: "Active VIPs",
      description: "Engaged customers",
      rules
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: created });
  });

  it("rejects a body with an unrecognised rule field", async () => {
    await expect(
      segmentController.create(
        {
          body: {
            organizationId: "org_1",
            name: "Bad",
            rules: { field: "notAField", eq: "x" }
          }
        } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(segmentService.create).not.toHaveBeenCalled();
  });

  it("rejects a rule tree nested deeper than the depth bound", async () => {
    // The schema bounds nesting at 5 levels so a pathological tree cannot blow
    // up query compilation; six levels of AND must not reach the service.
    let deep: unknown = { field: "status", eq: "ACTIVE" };
    for (let i = 0; i < 6; i += 1) {
      deep = { op: "AND", rules: [deep] };
    }

    await expect(
      segmentController.create(
        { body: { organizationId: "org_1", name: "Deep", rules: deep } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(segmentService.create).not.toHaveBeenCalled();
  });
});

describe("segmentController.preview", () => {
  it("returns a live count plus sample without persisting a segment", async () => {
    const result = { count: 42, sample: [{ id: "con_1" }] };
    vi.mocked(segmentService.preview).mockResolvedValue(result as never);
    const res = mockRes();

    await segmentController.preview(
      { body: { organizationId: "org_1", rules } } as Request,
      res
    );

    expect(segmentService.preview).toHaveBeenCalledWith({
      organizationId: "org_1",
      rules
    });
    expect(res.json).toHaveBeenCalledWith({ data: result });
    // Preview is read-only: no write path may be touched.
    expect(segmentService.create).not.toHaveBeenCalled();
    expect(segmentService.update).not.toHaveBeenCalled();
  });

  it("rejects a preview body with no rules", async () => {
    await expect(
      segmentController.preview(
        { body: { organizationId: "org_1" } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(segmentService.preview).not.toHaveBeenCalled();
  });
});

describe("segmentController.get", () => {
  it("returns the segment resolved by the service", async () => {
    const segment = { id: "seg_1", rules };
    vi.mocked(segmentService.get).mockResolvedValue(segment as never);
    const res = mockRes();

    await segmentController.get(
      { params: { id: "seg_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(segmentService.get).toHaveBeenCalledWith("seg_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: segment });
  });

  it("propagates the service's not-found error rather than shaping a 404 itself", async () => {
    // Unlike templates/drafts, this controller has no null branch: the service
    // throws HttpError(404) and the error middleware renders it.
    vi.mocked(segmentService.get).mockRejectedValue(
      new Error("Segment not found")
    );

    await expect(
      segmentController.get(
        { params: { id: "missing" }, userId: "usr_1" } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow("Segment not found");
  });
});

describe("segmentController.update", () => {
  it("updates a segment's rule tree", async () => {
    const updated = { id: "seg_1", name: "Renamed" };
    vi.mocked(segmentService.update).mockResolvedValue(updated as never);
    const res = mockRes();

    await segmentController.update(
      {
        params: { id: "seg_1" },
        userId: "usr_1",
        body: { name: "Renamed", rules }
      } as unknown as Request,
      res
    );

    // organizationId is omitted from the update schema — a segment cannot be
    // moved between orgs, so it must not be forwarded even if a client sends it.
    expect(segmentService.update).toHaveBeenCalledWith("seg_1", "usr_1", {
      name: "Renamed",
      rules
    });
    expect(res.json).toHaveBeenCalledWith({ data: updated });
  });

  it("rejects an update body missing a name", async () => {
    await expect(
      segmentController.update(
        {
          params: { id: "seg_1" },
          userId: "usr_1",
          body: { rules }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(segmentService.update).not.toHaveBeenCalled();
  });
});

describe("segmentController.remove", () => {
  it("removes by id and responds 204 with no body", async () => {
    vi.mocked(segmentService.remove).mockResolvedValue(undefined as never);
    const res = mockRes();

    await segmentController.remove(
      { params: { id: "seg_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(segmentService.remove).toHaveBeenCalledWith("seg_1", "usr_1");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});
