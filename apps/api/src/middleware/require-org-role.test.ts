import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../lib/http-error.js";
import { requireOrgRole } from "./require-org-role.js";

function fakeReq(orgRole?: string): Request {
  return { orgRole } as unknown as Request;
}

describe("requireOrgRole", () => {
  it("calls next when the pinned role is in the allowed set", () => {
    const next = vi.fn();

    requireOrgRole("OWNER", "ADMIN")(
      fakeReq("ADMIN"),
      {} as Response,
      next as unknown as NextFunction
    );

    expect(next).toHaveBeenCalledOnce();
  });

  it("throws 403 for a member whose role is not allowed", () => {
    expect(() =>
      requireOrgRole("OWNER", "ADMIN")(
        fakeReq("MEMBER"),
        {} as Response,
        vi.fn() as unknown as NextFunction
      )
    ).toThrowError(
      expect.objectContaining({ statusCode: 403 }) as unknown as HttpError
    );
  });

  it("throws 403 when no role was pinned (requireOrgMembership did not run)", () => {
    const next = vi.fn();

    expect(() =>
      requireOrgRole("OWNER")(
        fakeReq(undefined),
        {} as Response,
        next as unknown as NextFunction
      )
    ).toThrow(HttpError);
    expect(next).not.toHaveBeenCalled();
  });
});
