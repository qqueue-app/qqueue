import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/http-error.js";
import { verifyAccessToken } from "../lib/tokens.js";

/**
 * Verifies the bearer access token and attaches the user to the request.
 * Every route mounted after this middleware requires a valid access token.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "Authentication required");
  }

  const payload = verifyAccessToken(header.slice("Bearer ".length).trim());
  req.userId = payload.sub;
  req.userEmail = payload.email;
  next();
}
