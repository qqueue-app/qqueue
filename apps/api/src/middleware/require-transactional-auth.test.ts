import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";

// The API-key service hashes and hits the database; stub it so these tests pin
// the middleware's dispatch contract (key path vs JWT path) rather than
// re-testing key storage. Org access runs for real against the Prisma mock.
const h = vi.hoisted(() => ({
  authenticate: vi.fn(),
}));
vi.mock("../modules/api-keys/service.js", () => ({
  apiKeyService: { authenticate: h.authenticate },
}));

const { requireTransactionalAuth } =
  await import("./require-transactional-auth.js");
const { createAuthTokens } = await import("../lib/tokens.js");

function fakeReq(input: {
  authorization?: string;
  body?: Record<string, unknown>;
}): Request {
  return {
    headers: input.authorization ? { authorization: input.authorization } : {},
    body: input.body ?? {},
  } as unknown as Request;
}

const run = (req: Request) => {
  const next = vi.fn();
  return requireTransactionalAuth(
    req,
    {} as Response,
    next as unknown as NextFunction
  ).then(() => next);
};

beforeEach(() => {
  h.authenticate.mockReset();
});

describe("requireTransactionalAuth", () => {
  it("throws 401 without a bearer token", async () => {
    await expect(run(fakeReq({}))).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      run(fakeReq({ authorization: "Basic abc" }))
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("binds the org from a valid API key and ignores the body organizationId", async () => {
    h.authenticate.mockResolvedValue({ id: "key_1", organizationId: "org_1" });
    const req = fakeReq({
      authorization: "Bearer qq_live_abc",
      // A hostile caller must not be able to steer an API-key send cross-org.
      body: { organizationId: "org_other" },
    });

    const next = await run(req);

    expect(h.authenticate).toHaveBeenCalledWith("qq_live_abc");
    expect(req.apiKeyId).toBe("key_1");
    expect(req.organizationId).toBe("org_1");
    expect(next).toHaveBeenCalledOnce();
  });

  it("throws 401 for an unknown or revoked API key", async () => {
    h.authenticate.mockResolvedValue(null);
    await expect(
      run(fakeReq({ authorization: "Bearer qq_live_bad" }))
    ).rejects.toMatchObject({ statusCode: 401, code: "invalid_api_key" });
  });

  it("pins org and role for a valid JWT with membership", async () => {
    const { accessToken } = createAuthTokens({ id: "user_1", email: "a@b.co" });
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    const req = fakeReq({
      authorization: `Bearer ${accessToken}`,
      body: { organizationId: "org_1" },
    });

    const next = await run(req);

    expect(req.userId).toBe("user_1");
    expect(req.organizationId).toBe("org_1");
    expect(req.orgRole).toBe("MEMBER");
    expect(next).toHaveBeenCalledOnce();
  });

  it("throws 400 when a JWT request omits organizationId", async () => {
    const { accessToken } = createAuthTokens({ id: "user_1", email: "a@b.co" });
    await expect(
      run(fakeReq({ authorization: `Bearer ${accessToken}` }))
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 403 when the JWT user is not a member of the org", async () => {
    const { accessToken } = createAuthTokens({ id: "user_1", email: "a@b.co" });
    prismaMock.organizationMember.findUnique.mockResolvedValue(null);
    await expect(
      run(
        fakeReq({
          authorization: `Bearer ${accessToken}`,
          body: { organizationId: "org_1" },
        })
      )
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("throws 401 for a garbage JWT", async () => {
    await expect(
      run(fakeReq({ authorization: "Bearer not.a.token" }))
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
