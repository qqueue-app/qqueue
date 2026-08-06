import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";

/**
 * Signed tracking and unsubscribe tokens encode recipient identity; logged
 * verbatim they turn the request log into a recipient list (and a replayable
 * unsubscribe link). Collapse the token segment / query instead of logging it.
 */
export function loggableUrl(originalUrl: string): string {
  const [pathname] = originalUrl.split("?");
  if (pathname.startsWith("/api/v1/track/")) {
    // /api/v1/track/open/<token> -> /api/v1/track/open/:token
    return pathname.replace(/^(\/api\/v1\/track\/[^/]+)\/.*$/, "$1/:token");
  }
  if (pathname.startsWith("/api/v1/unsubscribe")) {
    // Token travels in the query string; drop it.
    return pathname;
  }
  return originalUrl;
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();
  req.id = randomUUID();

  res.on("finish", () => {
    logger.info(
      {
        reqId: req.id,
        method: req.method,
        url: loggableUrl(req.originalUrl),
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        // Auth middlewares run after this one, so these are populated by the
        // time the response finishes — undefined for public routes.
        userId: req.userId,
        organizationId: req.organizationId,
      },
      "request"
    );
  });

  next();
}
