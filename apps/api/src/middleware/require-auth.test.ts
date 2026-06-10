import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../lib/http-error.js";
import { createAuthTokens } from "../lib/tokens.js";
import { requireAuth } from "./require-auth.js";

function fakeReq(headers: Record<string, string | undefined>): Request {
  return { headers } as unknown as Request;
}

describe("requireAuth", () => {
  it("attaches userId and userEmail for a valid bearer token", () => {
    const { accessToken } = createAuthTokens({ id: "user_1", email: "a@b.com" });
    const req = fakeReq({ authorization: `Bearer ${accessToken}` });
    const next = vi.fn();

    requireAuth(req, {} as Response, next as unknown as NextFunction);

    expect(req.userId).toBe("user_1");
    expect(req.userEmail).toBe("a@b.com");
    expect(next).toHaveBeenCalledOnce();
  });

  it("throws 401 when the authorization header is missing", () => {
    const req = fakeReq({});
    expect(() =>
      requireAuth(req, {} as Response, vi.fn() as unknown as NextFunction)
    ).toThrow(HttpError);
  });

  it("throws 401 when the header is not a Bearer token", () => {
    const req = fakeReq({ authorization: "Basic abc" });
    expect(() =>
      requireAuth(req, {} as Response, vi.fn() as unknown as NextFunction)
    ).toThrow("Authentication required");
  });
});
