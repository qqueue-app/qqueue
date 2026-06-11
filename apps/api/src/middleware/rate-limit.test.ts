import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

const redis = vi.hoisted(() => ({
  incr: vi.fn(),
  expire: vi.fn(),
  ttl: vi.fn()
}));

vi.mock("../lib/redis.js", () => ({ redis }));

const { rateLimit } = await import("./rate-limit.js");

function req(ip = "127.0.0.1") {
  return { ip, socket: {} } as Request;
}

function res() {
  return { setHeader: vi.fn() } as unknown as Response;
}

describe("rateLimit", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.clearAllMocks();
  });

  it("increments a Redis key and allows requests inside the limit", async () => {
    process.env.NODE_ENV = "development";
    redis.incr.mockResolvedValue(1);
    const next = vi.fn() as NextFunction;

    await rateLimit({ keyPrefix: "login", windowSeconds: 60, max: 2 })(
      req(),
      res(),
      next
    );

    expect(redis.incr).toHaveBeenCalledWith("rate-limit:login:127.0.0.1");
    expect(redis.expire).toHaveBeenCalledWith(
      "rate-limit:login:127.0.0.1",
      60
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("throws 429 and sets Retry-After above the limit", async () => {
    process.env.NODE_ENV = "development";
    redis.incr.mockResolvedValue(3);
    redis.ttl.mockResolvedValue(42);
    const response = res();

    await expect(
      rateLimit({ keyPrefix: "login", windowSeconds: 60, max: 2 })(
        req(),
        response,
        vi.fn() as NextFunction
      )
    ).rejects.toMatchObject({ statusCode: 429 });

    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "42");
  });

  it("bypasses Redis in tests", async () => {
    process.env.NODE_ENV = "test";
    const next = vi.fn() as NextFunction;

    await rateLimit({ keyPrefix: "login", windowSeconds: 60, max: 2 })(
      req(),
      res(),
      next
    );

    expect(redis.incr).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
