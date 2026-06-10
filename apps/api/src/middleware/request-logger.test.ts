import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { requestLogger } from "./request-logger.js";

describe("requestLogger", () => {
  it("logs method, url, status and elapsed time when the response finishes", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let finishHandler: (() => void) | undefined;

    const req = {
      method: "GET",
      originalUrl: "/health"
    } as unknown as Request;
    const res = {
      statusCode: 200,
      on: (event: string, handler: () => void) => {
        if (event === "finish") finishHandler = handler;
      }
    } as unknown as Response;
    const next = vi.fn();

    requestLogger(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();

    finishHandler?.();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("GET /health 200")
    );

    logSpy.mockRestore();
  });
});
