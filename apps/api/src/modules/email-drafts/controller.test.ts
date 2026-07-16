import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  emailDraftService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  }
}));

const { emailDraftController } = await import("./controller.js");
const { emailDraftService } = await import("./service.js");

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

describe("emailDraftController.list", () => {
  it("lists drafts scoped to both the pinned org and the requesting user", async () => {
    const rows = [{ id: "drf_1" }];
    vi.mocked(emailDraftService.list).mockResolvedValue(rows as never);
    const res = mockRes();

    await emailDraftController.list(
      { organizationId: "org_1", userId: "usr_1" } as Request,
      res
    );

    // Drafts are personal, so the user id is as load-bearing as the org id.
    expect(emailDraftService.list).toHaveBeenCalledWith("org_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: rows });
  });
});

describe("emailDraftController.get", () => {
  it("returns the draft when the service resolves one", async () => {
    const draft = { id: "drf_1", attachments: [] };
    vi.mocked(emailDraftService.get).mockResolvedValue(draft as never);
    const res = mockRes();

    await emailDraftController.get(
      { params: { id: "drf_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(emailDraftService.get).toHaveBeenCalledWith("drf_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: draft });
  });

  it("responds 404 when the draft is not visible to the user", async () => {
    vi.mocked(emailDraftService.get).mockResolvedValue(null as never);
    const res = mockRes();

    await emailDraftController.get(
      { params: { id: "missing" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: "Draft not found" }
    });
  });
});

describe("emailDraftController.create", () => {
  it("creates a draft for the requesting user and responds 201", async () => {
    const created = { id: "drf_1" };
    vi.mocked(emailDraftService.create).mockResolvedValue(created as never);
    const res = mockRes();

    const body = {
      organizationId: "org_1",
      subject: "Hello {{firstName}}",
      html: "<p>Hi {{firstName}}</p>",
      to: ["someone@example.com"],
      cc: [],
      bcc: [],
      contactIds: ["con_1"],
      listIds: ["lst_1"],
      smtpConnectionId: "smtp_1",
      templateId: "tpl_1",
      variables: { firstName: "Ada" }
    };

    await emailDraftController.create(
      { body, userId: "usr_1" } as Request,
      res
    );

    // The user id comes from the session, never from the body.
    expect(emailDraftService.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1" }),
      "usr_1"
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: created });
  });

  it("accepts a near-empty draft — only organizationId is required", async () => {
    vi.mocked(emailDraftService.create).mockResolvedValue({
      id: "drf_2"
    } as never);
    const res = mockRes();

    await emailDraftController.create(
      { body: { organizationId: "org_1" }, userId: "usr_1" } as Request,
      res
    );

    expect(emailDraftService.create).toHaveBeenCalledWith(
      { organizationId: "org_1" },
      "usr_1"
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("rejects a body missing organizationId before reaching the service", async () => {
    await expect(
      emailDraftController.create(
        { body: { subject: "orphan" }, userId: "usr_1" } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(emailDraftService.create).not.toHaveBeenCalled();
  });
});

describe("emailDraftController.update", () => {
  it("applies a partial update", async () => {
    const updated = { id: "drf_1", subject: "Revised" };
    vi.mocked(emailDraftService.update).mockResolvedValue(updated as never);
    const res = mockRes();

    await emailDraftController.update(
      {
        params: { id: "drf_1" },
        userId: "usr_1",
        body: { subject: "Revised" }
      } as unknown as Request,
      res
    );

    expect(emailDraftService.update).toHaveBeenCalledWith("drf_1", "usr_1", {
      subject: "Revised"
    });
    expect(res.json).toHaveBeenCalledWith({ data: updated });
  });

  it("rejects a body whose field types are wrong", async () => {
    await expect(
      emailDraftController.update(
        {
          params: { id: "drf_1" },
          userId: "usr_1",
          // `to` is an array of strings; a bare string must not pass.
          body: { to: "someone@example.com" }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(emailDraftService.update).not.toHaveBeenCalled();
  });
});

describe("emailDraftController.delete", () => {
  it("deletes by id and responds 204 with no body", async () => {
    vi.mocked(emailDraftService.delete).mockResolvedValue(undefined as never);
    const res = mockRes();

    await emailDraftController.delete(
      { params: { id: "drf_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(emailDraftService.delete).toHaveBeenCalledWith("drf_1", "usr_1");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});
