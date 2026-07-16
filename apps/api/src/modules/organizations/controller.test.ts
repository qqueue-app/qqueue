import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  organizationService: {
    list: vi.fn(),
    get: vi.fn(),
    listMembers: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn()
  }
}));

const { organizationController } = await import("./controller.js");
const { organizationService } = await import("./service.js");

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

describe("organizationController.list", () => {
  it("lists organizations for the user pinned by requireAuth", async () => {
    const rows = [{ id: "org_1" }];
    vi.mocked(organizationService.list).mockResolvedValue(rows as never);
    const res = mockRes();

    await organizationController.list({ userId: "usr_1" } as Request, res);

    expect(organizationService.list).toHaveBeenCalledWith("usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: rows });
  });
});

describe("organizationController.get", () => {
  it("returns the organization scoped to the requesting user", async () => {
    const org = { id: "org_1", name: "Acme" };
    vi.mocked(organizationService.get).mockResolvedValue(org as never);
    const res = mockRes();

    await organizationController.get(
      { params: { id: "org_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(organizationService.get).toHaveBeenCalledWith("org_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: org });
  });

  it("responds 404 when the service returns nothing", async () => {
    vi.mocked(organizationService.get).mockResolvedValue(null as never);
    const res = mockRes();

    await organizationController.get(
      { params: { id: "org_missing" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: "Organization not found" }
    });
  });

  it("coerces a non-string route param to a string before the service sees it", async () => {
    vi.mocked(organizationService.get).mockResolvedValue({ id: "1" } as never);

    await organizationController.get(
      { params: { id: 1 }, userId: "usr_1" } as unknown as Request,
      mockRes()
    );

    expect(organizationService.get).toHaveBeenCalledWith("1", "usr_1");
  });
});

describe("organizationController.listMembers", () => {
  it("lists members of the organization", async () => {
    const members = [{ userId: "usr_1", role: "OWNER" }];
    vi.mocked(organizationService.listMembers).mockResolvedValue(members as never);
    const res = mockRes();

    await organizationController.listMembers(
      { params: { id: "org_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(organizationService.listMembers).toHaveBeenCalledWith("org_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: members });
  });
});

describe("organizationController.create", () => {
  it("creates an organization and responds 201", async () => {
    const created = { id: "org_1", name: "Acme" };
    vi.mocked(organizationService.create).mockResolvedValue(created as never);
    const res = mockRes();

    await organizationController.create(
      { body: { name: "Acme" }, userId: "usr_1" } as Request,
      res
    );

    expect(organizationService.create).toHaveBeenCalledWith({ name: "Acme" }, "usr_1");
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: created });
  });

  it("rejects an empty name before reaching the service", async () => {
    await expect(
      organizationController.create(
        { body: { name: "" }, userId: "usr_1" } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(organizationService.create).not.toHaveBeenCalled();
  });
});

describe("organizationController.update", () => {
  it("updates the organization with (id, userId, input) in that order", async () => {
    const updated = { id: "org_1", name: "Acme Corp" };
    vi.mocked(organizationService.update).mockResolvedValue(updated as never);
    const res = mockRes();

    await organizationController.update(
      { params: { id: "org_1" }, body: { name: "Acme Corp" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(organizationService.update).toHaveBeenCalledWith("org_1", "usr_1", {
      name: "Acme Corp"
    });
    expect(res.json).toHaveBeenCalledWith({ data: updated });
  });

  it("rejects an invalid body before reaching the service", async () => {
    await expect(
      organizationController.update(
        { params: { id: "org_1" }, body: {}, userId: "usr_1" } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(organizationService.update).not.toHaveBeenCalled();
  });
});

describe("organizationController.delete", () => {
  it("deletes and responds 204 with no body", async () => {
    vi.mocked(organizationService.delete).mockResolvedValue(undefined as never);
    const res = mockRes();

    await organizationController.delete(
      { params: { id: "org_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(organizationService.delete).toHaveBeenCalledWith("org_1", "usr_1");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});

describe("organizationController.updateMemberRole", () => {
  it("unwraps role from the body and passes (orgId, targetUserId, actorUserId, role)", async () => {
    const member = { userId: "usr_2", role: "ADMIN" };
    vi.mocked(organizationService.updateMemberRole).mockResolvedValue(member as never);
    const res = mockRes();

    await organizationController.updateMemberRole(
      {
        params: { id: "org_1", userId: "usr_2" },
        body: { role: "ADMIN" },
        userId: "usr_1"
      } as unknown as Request,
      res
    );

    // req.params.userId is the member being changed; req.userId is the actor
    // pinned by requireAuth. The order matters — they are both strings.
    expect(organizationService.updateMemberRole).toHaveBeenCalledWith(
      "org_1",
      "usr_2",
      "usr_1",
      "ADMIN"
    );
    expect(res.json).toHaveBeenCalledWith({ data: member });
  });

  it("rejects a role outside the enum before reaching the service", async () => {
    await expect(
      organizationController.updateMemberRole(
        {
          params: { id: "org_1", userId: "usr_2" },
          body: { role: "SUPERUSER" },
          userId: "usr_1"
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(organizationService.updateMemberRole).not.toHaveBeenCalled();
  });

  it("surfaces a service refusal (e.g. demoting the last owner)", async () => {
    vi.mocked(organizationService.updateMemberRole).mockRejectedValue(
      new Error("Cannot demote the last owner")
    );

    await expect(
      organizationController.updateMemberRole(
        {
          params: { id: "org_1", userId: "usr_2" },
          body: { role: "MEMBER" },
          userId: "usr_1"
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow("Cannot demote the last owner");
  });
});

describe("organizationController.removeMember", () => {
  it("removes the member and responds 204 with no body", async () => {
    vi.mocked(organizationService.removeMember).mockResolvedValue(undefined as never);
    const res = mockRes();

    await organizationController.removeMember(
      { params: { id: "org_1", userId: "usr_2" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(organizationService.removeMember).toHaveBeenCalledWith("org_1", "usr_2", "usr_1");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});
