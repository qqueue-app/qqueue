import type { NextFunction, Request, Response } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const elapsedMs = Date.now() - startedAt;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${elapsedMs}ms`);
  });

  next();
}
