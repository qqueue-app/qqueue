import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("../lib/logger.js", () => ({ logger: { info: h.info } }));

const { loggableUrl, requestLogger } = await import("./request-logger.js");

function runRequest(overrides: Partial<Request> = {}) {
  let finishHandler: (() => void) | undefined;
  const req = {
    method: "GET",
    originalUrl: "/health",
    ...overrides,
  } as unknown as Request;
  const res = {
    statusCode: 200,
    on: (event: string, handler: () => void) => {
      if (event === "finish") finishHandler = handler;
    },
  } as unknown as Response;
  const next = vi.fn();

  requestLogger(req, res, next as unknown as NextFunction);
  finishHandler?.();
  return { req, next };
}

describe("requestLogger", () => {
  it("assigns a request id and logs one structured line on finish", () => {
    h.info.mockClear();
    const { req, next } = runRequest({ userId: "user_1" } as never);

    expect(next).toHaveBeenCalledOnce();
    expect(req.id).toEqual(expect.any(String));
    expect(h.info).toHaveBeenCalledWith(
      expect.objectContaining({
        reqId: req.id,
        method: "GET",
        url: "/health",
        status: 200,
        durationMs: expect.any(Number),
        userId: "user_1",
      }),
      "request"
    );
  });
});

// Signed tokens encode recipient identity — they must never land in logs.
describe("loggableUrl", () => {
  it("collapses tracking token path segments", () => {
    expect(loggableUrl("/api/v1/track/open/abc.def.ghi")).toBe(
      "/api/v1/track/open/:token"
    );
    expect(loggableUrl("/api/v1/track/click/abc.def.ghi?x=1")).toBe(
      "/api/v1/track/click/:token"
    );
  });

  it("strips the unsubscribe query string", () => {
    expect(loggableUrl("/api/v1/unsubscribe?token=secret.signed.token")).toBe(
      "/api/v1/unsubscribe"
    );
  });

  it("keeps ordinary urls verbatim, query included", () => {
    expect(loggableUrl("/api/v1/contacts?organizationId=org_1")).toBe(
      "/api/v1/contacts?organizationId=org_1"
    );
  });
});
