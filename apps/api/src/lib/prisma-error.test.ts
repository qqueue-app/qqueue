import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { describe, expect, it } from "vitest";
import {
  isPrismaKnownRequestError,
  uniqueConstraintFields
} from "./prisma-error.js";

// The generated client's errors come from its own CJS copy of the Prisma
// runtime, so they are not instances of the class this (ESM) file imports.
function foreignCopyError(code: string, meta?: Record<string, unknown>) {
  return Object.assign(new Error("boom"), {
    name: "PrismaClientKnownRequestError",
    code,
    clientVersion: "6.19.3",
    ...(meta ? { meta } : {})
  });
}

describe("isPrismaKnownRequestError", () => {
  it("matches an error from the imported runtime copy", () => {
    const error = new PrismaClientKnownRequestError("boom", {
      code: "P2002",
      clientVersion: "6.19.3"
    });
    expect(isPrismaKnownRequestError(error)).toBe(true);
    expect(isPrismaKnownRequestError(error, "P2002")).toBe(true);
  });

  it("matches an error from the client's other runtime copy", () => {
    const error = foreignCopyError("P2002");
    expect(error).not.toBeInstanceOf(PrismaClientKnownRequestError);
    expect(isPrismaKnownRequestError(error, "P2002")).toBe(true);
  });

  it("rejects a different Prisma code when one is requested", () => {
    expect(isPrismaKnownRequestError(foreignCopyError("P2003"), "P2002")).toBe(
      false
    );
  });

  it("rejects non-Prisma values", () => {
    expect(isPrismaKnownRequestError(new Error("boom"), "P2002")).toBe(false);
    expect(isPrismaKnownRequestError(null)).toBe(false);
    expect(isPrismaKnownRequestError("P2002")).toBe(false);
    expect(isPrismaKnownRequestError({ name: "PrismaClientKnownRequestError" })).toBe(
      false
    );
  });
});

describe("uniqueConstraintFields", () => {
  it("drops the tenant scoping column", () => {
    const error = foreignCopyError("P2002", {
      modelName: "Contact",
      target: ["organizationId", "email"]
    });
    expect(uniqueConstraintFields(error)).toEqual(["email"]);
  });

  it("accepts a string target", () => {
    const error = foreignCopyError("P2002", { target: "email" });
    expect(uniqueConstraintFields(error)).toEqual(["email"]);
  });

  it("returns nothing when meta is absent", () => {
    expect(uniqueConstraintFields(foreignCopyError("P2002"))).toEqual([]);
  });
});
