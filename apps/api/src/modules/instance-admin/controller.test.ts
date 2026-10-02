import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./service.js", () => ({
  instanceAdminService: {
    listOrganizations: vi.fn(),
    getOrganization: vi.fn(),
    listMailboxes: vi.fn(),
    listDomainGrants: vi.fn(),
    addDomainGrant: vi.fn(),
    listMutes: vi.fn(),
    addMute: vi.fn(),
    removeMute: vi.fn(),
  },
}));

const { instanceAdminController } = await import("./controller.js");
const { instanceAdminService } = await import("./service.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => vi.clearAllMocks());

describe("instanceAdminController", () => {
  it("uses the signed-in administrator for organization and mailbox inventory", async () => {
    const organizations = [{ id: "org_1", name: "Acme" }];
    const mailboxes = [{ email: "hello@acme.test" }];
    vi.mocked(instanceAdminService.listOrganizations).mockResolvedValue(
      organizations as never
    );
    vi.mocked(instanceAdminService.listMailboxes).mockResolvedValue(
      mailboxes as never
    );
    const req = { userId: "admin_1" } as Request;
    const organizationsRes = mockRes();
    const mailboxesRes = mockRes();

    await instanceAdminController.listOrganizations(req, organizationsRes);
    await instanceAdminController.listMailboxes(req, mailboxesRes);

    expect(instanceAdminService.listOrganizations).toHaveBeenCalledWith(
      "admin_1"
    );
    expect(instanceAdminService.listMailboxes).toHaveBeenCalledWith("admin_1");
    expect(organizationsRes.json).toHaveBeenCalledWith({ data: organizations });
    expect(mailboxesRes.json).toHaveBeenCalledWith({ data: mailboxes });
  });

  it("scopes organization detail and personal mutes to the signed-in administrator", async () => {
    const detail = { id: "org_2", name: "Beta" };
    const mutes = [{ id: "mute_1", scope: "ORG", target: "org_2" }];
    vi.mocked(instanceAdminService.getOrganization).mockResolvedValue(
      detail as never
    );
    vi.mocked(instanceAdminService.listMutes).mockResolvedValue(mutes as never);
    const detailRes = mockRes();
    const mutesRes = mockRes();

    await instanceAdminController.getOrganization(
      { userId: "admin_1", params: { id: "org_2" } } as unknown as Request,
      detailRes
    );
    await instanceAdminController.listMutes(
      { userId: "admin_1" } as Request,
      mutesRes
    );

    expect(instanceAdminService.getOrganization).toHaveBeenCalledWith(
      "org_2",
      "admin_1"
    );
    expect(instanceAdminService.listMutes).toHaveBeenCalledWith("admin_1");
    expect(detailRes.json).toHaveBeenCalledWith({ data: detail });
    expect(mutesRes.json).toHaveBeenCalledWith({ data: mutes });
  });

  it("passes only a string organization filter to domain-grant inventory", async () => {
    vi.mocked(instanceAdminService.listDomainGrants).mockResolvedValue(
      [] as never
    );
    const res = mockRes();

    await instanceAdminController.listDomainGrants(
      { query: { organizationId: ["org_1", "org_2"] } } as unknown as Request,
      res
    );
    expect(instanceAdminService.listDomainGrants).toHaveBeenLastCalledWith(
      undefined
    );

    await instanceAdminController.listDomainGrants(
      { query: { organizationId: "org_1" } } as unknown as Request,
      res
    );
    expect(instanceAdminService.listDomainGrants).toHaveBeenLastCalledWith(
      "org_1"
    );
  });

  it("validates personal mutes before writing them and returns the created mute", async () => {
    const mute = { id: "mute_1", scope: "ORG", target: "org_2" };
    vi.mocked(instanceAdminService.addMute).mockResolvedValue(mute as never);
    const res = mockRes();

    await expect(
      instanceAdminController.addMute(
        {
          userId: "admin_1",
          body: { scope: "INVALID", target: "org_2" },
        } as Request,
        res
      )
    ).rejects.toThrow();
    expect(instanceAdminService.addMute).not.toHaveBeenCalled();

    await instanceAdminController.addMute(
      { userId: "admin_1", body: { scope: "ORG", target: "org_2" } } as Request,
      res
    );
    expect(instanceAdminService.addMute).toHaveBeenCalledWith("admin_1", {
      scope: "ORG",
      target: "org_2",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: mute });
  });

  it("removes a mute only for the signed-in administrator", async () => {
    const res = mockRes();
    await instanceAdminController.removeMute(
      { userId: "admin_1", params: { id: "mute_1" } } as unknown as Request,
      res
    );
    expect(instanceAdminService.removeMute).toHaveBeenCalledWith(
      "mute_1",
      "admin_1"
    );
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalledWith();
  });
});
