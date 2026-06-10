import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";
import { HttpError } from "../lib/http-error.js";
import { requireOrgMembership } from "./require-org.js";

function fakeReq(partial: Partial<Request>): Request {
  return { query: {}, body: {}, ...partial } as unknown as Request;
}

describe("requireOrgMembership", () => {
  it("pins organizationId and role from the query string", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "OWNER"
    } as never);
    const req = fakeReq({
      userId: "user_1",
      query: { organizationId: "org_1" }
    });
    const next = vi.fn();

    await requireOrgMembership(req, {} as Response, next as unknown as NextFunction);

    expect(req.organizationId).toBe("org_1");
    expect(req.orgRole).toBe("OWNER");
    expect(next).toHaveBeenCalledOnce();
  });

  it("reads organizationId from the body when not in the query", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER"
    } as never);
    const req = fakeReq({
      userId: "user_1",
      body: { organizationId: "org_2" }
    });
    const next = vi.fn();

    await requireOrgMembership(req, {} as Response, next as unknown as NextFunction);

    expect(req.organizationId).toBe("org_2");
    expect(req.orgRole).toBe("MEMBER");
  });

  it("throws 401 when there is no authenticated user", async () => {
    const req = fakeReq({ query: { organizationId: "org_1" } });
    await expect(
      requireOrgMembership(req, {} as Response, vi.fn() as unknown as NextFunction)
    ).rejects.toThrow("Authentication required");
  });

  it("throws 400 when organizationId is missing", async () => {
    const req = fakeReq({ userId: "user_1" });
    await expect(
      requireOrgMembership(req, {} as Response, vi.fn() as unknown as NextFunction)
    ).rejects.toThrow("organizationId is required");
  });

  it("throws 403 when the user is not a member", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue(null);
    const req = fakeReq({
      userId: "user_1",
      query: { organizationId: "org_1" }
    });
    await expect(
      requireOrgMembership(req, {} as Response, vi.fn() as unknown as NextFunction)
    ).rejects.toThrow(HttpError);
  });
});
