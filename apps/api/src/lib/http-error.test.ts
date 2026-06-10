import { describe, expect, it } from "vitest";
import { HttpError } from "./http-error.js";

describe("HttpError", () => {
  it("carries a status code and message", () => {
    const error = new HttpError(418, "I'm a teapot");
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(418);
    expect(error.message).toBe("I'm a teapot");
    expect(error.name).toBe("HttpError");
  });
});
