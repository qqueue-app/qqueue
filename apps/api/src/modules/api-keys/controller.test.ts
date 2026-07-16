import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  apiKeyService: {
    list: vi.fn(),
    create: vi.fn(),
    revoke: vi.fn()
  }
}));

const { apiKeyController } = await import("./controller.js");
const { apiKeyService } = await import("./service.js");

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

describe("apiKeyController.list", () => {
  it("lists keys for the org in the query, scoped to the caller", async () => {
    const rows = [{ id: "key_1" }];
    vi.mocked(apiKeyService.list).mockResolvedValue(rows as never);
    const res = mockRes();

    await apiKeyController.list(
      { query: { organizationId: "org_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(apiKeyService.list).toHaveBeenCalledWith("org_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: rows });
  });

  it("coerces a missing organizationId to an empty string rather than throwing", async () => {
    vi.mocked(apiKeyService.list).mockResolvedValue([] as never);
    const res = mockRes();

    await apiKeyController.list({ query: {}, userId: "usr_1" } as unknown as Request, res);

    expect(apiKeyService.list).toHaveBeenCalledWith("", "usr_1");
  });
});

describe("apiKeyController.create", () => {
  it("creates a key and responds 201 with the one-time plaintext key", async () => {
    // The service stores only the hash; `key` is returned once, here.
    const created = { apiKey: { id: "key_1", name: "CI" }, key: "qq_live_secret" };
    vi.mocked(apiKeyService.create).mockResolvedValue(created as never);
    const res = mockRes();

    await apiKeyController.create(
      { body: { organizationId: "org_1", name: "CI" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(apiKeyService.create).toHaveBeenCalledWith(
      { organizationId: "org_1", name: "CI" },
      "usr_1"
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: created });
  });

  it("rejects an invalid body before reaching the service", async () => {
    await expect(
      apiKeyController.create({ body: { name: "" }, userId: "usr_1" } as unknown as Request, mockRes())
    ).rejects.toThrow();
    expect(apiKeyService.create).not.toHaveBeenCalled();
  });
});

describe("apiKeyController.revoke", () => {
  it("revokes by id and returns the updated row", async () => {
    const revoked = { id: "key_1", revokedAt: new Date() };
    vi.mocked(apiKeyService.revoke).mockResolvedValue(revoked as never);
    const res = mockRes();

    await apiKeyController.revoke(
      { params: { id: "key_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(apiKeyService.revoke).toHaveBeenCalledWith("key_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: revoked });
  });

  it("propagates a service not-found error", async () => {
    vi.mocked(apiKeyService.revoke).mockRejectedValue(new Error("API key not found"));

    await expect(
      apiKeyController.revoke(
        { params: { id: "missing" }, userId: "usr_1" } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow("API key not found");
  });
});
