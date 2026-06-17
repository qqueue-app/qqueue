import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";

export function requireInboxEnabled(
  _req: Request,
  _res: Response,
  next: NextFunction
) {
  if (!env.INBOX_ENABLED) {
    throw new HttpError(404, "Inbox module is disabled", "feature_disabled");
  }
  next();
}
