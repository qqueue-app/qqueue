import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  contactListService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    createFromSegment: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  }
}));

const { contactListController } = await import("./controller.js");
const { contactListService } = await import("./service.js");

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

describe("contactListController.list", () => {
  it("lists contact lists for the org pinned by requireOrgMembership", async () => {
    const rows = [{ id: "lst_1" }];
    vi.mocked(contactListService.list).mockResolvedValue(rows as never);
    const res = mockRes();

    await contactListController.list({ organizationId: "org_1" } as Request, res);

    expect(contactListService.list).toHaveBeenCalledWith("org_1");
    expect(res.json).toHaveBeenCalledWith({ data: rows });
  });
});

describe("contactListController.get", () => {
  it("returns the list scoped to the requesting user", async () => {
    const row = { id: "lst_1" };
    vi.mocked(contactListService.get).mockResolvedValue(row as never);
    const res = mockRes();

    await contactListController.get(
      { params: { id: "lst_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(contactListService.get).toHaveBeenCalledWith("lst_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: row });
  });

  it("responds 404 when the list is not visible to the user", async () => {
    vi.mocked(contactListService.get).mockResolvedValue(null as never);
    const res = mockRes();

    await contactListController.get(
      { params: { id: "missing" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: "Contact list not found" }
    });
  });
});

describe("contactListController.create", () => {
  it("creates a list and responds 201", async () => {
    const created = { id: "lst_1" };
    vi.mocked(contactListService.create).mockResolvedValue(created as never);
    const res = mockRes();

    await contactListController.create(
      {
        body: {
          organizationId: "org_1",
          name: "Newsletter",
          contactIds: ["con_1", "con_2"]
        }
      } as Request,
      res
    );

    expect(contactListService.create).toHaveBeenCalledWith({
      organizationId: "org_1",
      name: "Newsletter",
      contactIds: ["con_1", "con_2"]
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: created });
  });

  it("rejects a list with no name", async () => {
    await expect(
      contactListController.create(
        { body: { organizationId: "org_1" } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(contactListService.create).not.toHaveBeenCalled();
  });
});

describe("contactListController.createFromSegment", () => {
  it("materializes a tag filter into a new list and responds 201", async () => {
    const created = { id: "lst_2" };
    vi.mocked(contactListService.createFromSegment).mockResolvedValue(
      created as never
    );
    const res = mockRes();

    await contactListController.createFromSegment(
      {
        body: {
          organizationId: "org_1",
          name: "VIPs",
          tags: ["vip"],
          match: "ALL",
          status: "ACTIVE"
        }
      } as Request,
      res
    );

    expect(contactListService.createFromSegment).toHaveBeenCalledWith({
      organizationId: "org_1",
      name: "VIPs",
      tags: ["vip"],
      match: "ALL",
      status: "ACTIVE"
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: created });
  });

  it("defaults match to ANY when omitted", async () => {
    vi.mocked(contactListService.createFromSegment).mockResolvedValue({} as never);

    await contactListController.createFromSegment(
      {
        body: { organizationId: "org_1", name: "Taggy", tags: ["a"] }
      } as Request,
      mockRes()
    );

    expect(contactListService.createFromSegment).toHaveBeenCalledWith(
      expect.objectContaining({ match: "ANY" })
    );
  });

  it("rejects a segment filter with no tags", async () => {
    await expect(
      contactListController.createFromSegment(
        { body: { organizationId: "org_1", name: "Empty", tags: [] } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(contactListService.createFromSegment).not.toHaveBeenCalled();
  });
});

describe("contactListController.update", () => {
  it("updates the list with the validated patch", async () => {
    const updated = { id: "lst_1", name: "Renamed" };
    vi.mocked(contactListService.update).mockResolvedValue(updated as never);
    const res = mockRes();

    await contactListController.update(
      {
        params: { id: "lst_1" },
        userId: "usr_1",
        body: { name: "Renamed" }
      } as unknown as Request,
      res
    );

    expect(contactListService.update).toHaveBeenCalledWith("lst_1", "usr_1", {
      name: "Renamed"
    });
    expect(res.json).toHaveBeenCalledWith({ data: updated });
  });

  it("rejects an update that blanks the name", async () => {
    await expect(
      contactListController.update(
        {
          params: { id: "lst_1" },
          userId: "usr_1",
          body: { name: "" }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(contactListService.update).not.toHaveBeenCalled();
  });
});

describe("contactListController.delete", () => {
  it("deletes by id and responds 204 with no body", async () => {
    vi.mocked(contactListService.delete).mockResolvedValue(undefined as never);
    const res = mockRes();

    await contactListController.delete(
      { params: { id: "lst_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(contactListService.delete).toHaveBeenCalledWith("lst_1", "usr_1");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});
