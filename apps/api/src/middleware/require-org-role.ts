import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@qqueue/shared";
import { HttpError } from "../lib/http-error.js";

/**
 * Restrict a route to members holding one of the given roles in the resolved
 * organization. Must run after `requireOrgMembership`, which pins `req.orgRole`.
 * Returns 403 for members without a permitted role.
 */
export function requireOrgRole(...roles: UserRole[]) {
  return function requireOrgRoleMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction
  ) {
    if (!req.orgRole || !roles.includes(req.orgRole)) {
      throw new HttpError(403, "You do not have permission to do this");
    }
    next();
  };
}
