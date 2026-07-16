import type { NextFunction, Request, Response } from "express";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HttpError } from "../lib/http-error.js";
import { errorHandler } from "./error-handler.js";

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

function run(error: unknown) {
  const res = fakeRes();
  errorHandler(
    error,
    {} as Request,
    res as unknown as Response,
    (() => undefined) as NextFunction
  );
  return res;
}

describe("errorHandler", () => {
  it("maps an HttpError to its status code and message", () => {
    const res = run(new HttpError(403, "Forbidden"));
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: { message: "Forbidden" } });
  });

  it("includes a stable code when an HttpError has one", () => {
    const res = run(new HttpError(401, "Invalid API key", "invalid_api_key"));
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: { code: "invalid_api_key", message: "Invalid API key" }
    });
  });

  it("maps a ZodError to 400 with issues", () => {
    let zodError: z.ZodError;
    try {
      z.object({ name: z.string() }).parse({});
      throw new Error("should have thrown");
    } catch (error) {
      zodError = error as z.ZodError;
    }
    const res = run(zodError);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toBe(
      "Invalid request body"
    );
    expect((res.body as { error: { issues: unknown[] } }).error.issues).toEqual(
      zodError.issues
    );
  });

  it("maps Prisma P2025 to 404", () => {
    const error = new PrismaClientKnownRequestError("not found", {
      code: "P2025",
      clientVersion: "6.0.0"
    });
    const res = run(error);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: { code: "not_found", message: "Resource not found" }
    });
  });

  it("maps Prisma P2002 to 409, naming the model and duplicated field", () => {
    const error = new PrismaClientKnownRequestError("conflict", {
      code: "P2002",
      clientVersion: "6.0.0",
      meta: { modelName: "Contact", target: ["organizationId", "email"] }
    });
    const res = run(error);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: "conflict",
        message: "A contact with this email address already exists"
      }
    });
  });

  it("falls back to a generic conflict message without usable meta", () => {
    const error = new PrismaClientKnownRequestError("conflict", {
      code: "P2002",
      clientVersion: "6.0.0"
    });
    const res = run(error);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: { code: "conflict", message: "That record already exists" }
    });
  });

  // The errors the running server actually sees come from the generated
  // client's CJS copy of the runtime, so they fail `instanceof` against the
  // class imported above (see lib/prisma-error.ts). Reproduce that shape
  // directly — a class-based test alone would pass while production 500s.
  it("maps a P2002 from the client's other runtime copy to 409", () => {
    const foreignCopyError = Object.assign(new Error("conflict"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      clientVersion: "6.19.3",
      meta: { modelName: "Contact", target: ["organizationId", "email"] }
    });
    expect(foreignCopyError).not.toBeInstanceOf(PrismaClientKnownRequestError);

    const res = run(foreignCopyError);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: "conflict",
        message: "A contact with this email address already exists"
      }
    });
  });

  it("maps an unknown error to 500 and logs it", () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const res = run(new Error("boom"));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: { message: "Internal server error" } });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("treats an unrecognised Prisma error code as a 500", () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const error = new PrismaClientKnownRequestError("other", {
      code: "P2003",
      clientVersion: "6.0.0"
    });
    const res = run(error);
    expect(res.statusCode).toBe(500);
    errorSpy.mockRestore();
  });
});
