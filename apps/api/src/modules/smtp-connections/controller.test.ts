import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  smtpConnectionService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  }
}));

const { smtpConnectionController } = await import("./controller.js");
const { smtpConnectionService } = await import("./service.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

// A complete, schema-valid smtpConnectionSchema body.
const validCreateBody = {
  organizationId: "org_1",
  name: "Primary",
  host: "smtp.example.com",
  port: 587,
  secure: false,
  username: "mailer",
  password: "s3cret",
  fromEmail: "hello@example.com",
  fromName: "Hello",
  isDefault: true
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("smtpConnectionController.list", () => {
  it("lists connections for the org pinned by requireOrgMembership", async () => {
    const rows = [{ id: "smtp_1" }];
    vi.mocked(smtpConnectionService.list).mockResolvedValue(rows as never);
    const res = mockRes();

    await smtpConnectionController.list({ organizationId: "org_1" } as Request, res);

    expect(smtpConnectionService.list).toHaveBeenCalledWith("org_1");
    expect(res.json).toHaveBeenCalledWith({ data: rows });
  });
});

describe("smtpConnectionController.get", () => {
  it("returns the connection scoped to the requesting user", async () => {
    const connection = { id: "smtp_1", name: "Primary" };
    vi.mocked(smtpConnectionService.get).mockResolvedValue(connection as never);
    const res = mockRes();

    await smtpConnectionController.get(
      { params: { id: "smtp_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(smtpConnectionService.get).toHaveBeenCalledWith("smtp_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: connection });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 404 when the service resolves nothing", async () => {
    vi.mocked(smtpConnectionService.get).mockResolvedValue(null as never);
    const res = mockRes();

    await smtpConnectionController.get(
      { params: { id: "missing" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: "SMTP connection not found" }
    });
  });
});

describe("smtpConnectionController.create", () => {
  it("creates a connection from a validated body and responds 201", async () => {
    const created = { id: "smtp_1" };
    vi.mocked(smtpConnectionService.create).mockResolvedValue(created as never);
    const res = mockRes();

    await smtpConnectionController.create({ body: validCreateBody } as Request, res);

    expect(smtpConnectionService.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", host: "smtp.example.com" })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: created });
  });

  it("rejects an invalid body before reaching the service", async () => {
    await expect(
      smtpConnectionController.create(
        { body: { ...validCreateBody, fromEmail: "not-an-email" } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(smtpConnectionService.create).not.toHaveBeenCalled();
  });

  it("surfaces a verification failure from the service", async () => {
    vi.mocked(smtpConnectionService.create).mockRejectedValue(
      new Error("Could not connect to the SMTP server")
    );

    await expect(
      smtpConnectionController.create({ body: validCreateBody } as Request, mockRes())
    ).rejects.toThrow("Could not connect to the SMTP server");
  });
});

describe("smtpConnectionController.update", () => {
  it("passes the validated partial body through to the service", async () => {
    const updated = { id: "smtp_1", name: "Renamed" };
    vi.mocked(smtpConnectionService.update).mockResolvedValue(updated as never);
    const res = mockRes();

    await smtpConnectionController.update(
      {
        params: { id: "smtp_1" },
        userId: "usr_1",
        body: { name: "Renamed", isDefault: true }
      } as unknown as Request,
      res
    );

    expect(smtpConnectionService.update).toHaveBeenCalledWith("smtp_1", "usr_1", {
      name: "Renamed",
      isDefault: true
    });
    expect(res.json).toHaveBeenCalledWith({ data: updated });
  });

  it("rejects an invalid update body before reaching the service", async () => {
    // The update schema is a plain .partial(), so {} is valid — only a
    // wrongly-typed field can fail it.
    await expect(
      smtpConnectionController.update(
        {
          params: { id: "smtp_1" },
          userId: "usr_1",
          body: { port: "not-a-number" }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(smtpConnectionService.update).not.toHaveBeenCalled();
  });
});

describe("smtpConnectionController.delete", () => {
  it("deletes by id and responds 204 with no body", async () => {
    vi.mocked(smtpConnectionService.delete).mockResolvedValue(undefined as never);
    const res = mockRes();

    await smtpConnectionController.delete(
      { params: { id: "smtp_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(smtpConnectionService.delete).toHaveBeenCalledWith("smtp_1", "usr_1");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});
