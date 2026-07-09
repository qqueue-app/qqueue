import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";
import { HttpError } from "../lib/http-error.js";
import { requireInstanceAdmin } from "./require-instance-admin.js";

function fakeReq(partial: Partial<Request>): Request {
  return { query: {}, body: {}, ...partial } as unknown as Request;
}

describe("requireInstanceAdmin", () => {
  it("passes instance admins through", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isInstanceAdmin: true
    } as never);
    const next = vi.fn();

    await requireInstanceAdmin(
      fakeReq({ userId: "user_1" }),
      {} as Response,
      next as unknown as NextFunction
    );

    expect(next).toHaveBeenCalledOnce();
  });

  it("throws 403 for regular users", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isInstanceAdmin: false
    } as never);

    await expect(
      requireInstanceAdmin(
        fakeReq({ userId: "user_2" }),
        {} as Response,
        vi.fn() as unknown as NextFunction
      )
    ).rejects.toThrow(HttpError);
  });

  it("throws 403 when the user no longer exists", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(
      requireInstanceAdmin(
        fakeReq({ userId: "user_gone" }),
        {} as Response,
        vi.fn() as unknown as NextFunction
      )
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
