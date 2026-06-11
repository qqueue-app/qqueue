import type { NextFunction, Request, Response } from "express";
import { redis } from "../lib/redis.js";
import { HttpError } from "../lib/http-error.js";

interface RateLimitOptions {
  keyPrefix: string;
  windowSeconds: number;
  max: number;
  key?: (req: Request) => string;
}

function clientIp(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function rateLimit(options: RateLimitOptions) {
  return async function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    if (process.env.NODE_ENV === "test") {
      next();
      return;
    }

    const identity = options.key?.(req) ?? clientIp(req);
    const key = `rate-limit:${options.keyPrefix}:${identity}`;

    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, options.windowSeconds);
    }

    const remaining = Math.max(0, options.max - count);
    res.setHeader("X-RateLimit-Limit", String(options.max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    if (count > options.max) {
      const ttl = await redis.ttl(key);
      if (ttl > 0) {
        res.setHeader("Retry-After", String(ttl));
      }
      throw new HttpError(429, "Too many requests");
    }

    next();
  };
}
