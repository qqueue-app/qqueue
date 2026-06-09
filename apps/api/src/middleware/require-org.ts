import type { NextFunction, Request, Response } from "express";
import { assertOrgAccess } from "../lib/org-access.js";
import { HttpError } from "../lib/http-error.js";

/**
 * Resolves the target organization from the request (query for reads, body for
 * writes), confirms the authenticated user is a member, and pins the verified
 * org id + role onto the request. Use on routes that carry an organizationId.
 *
 * Routes addressed by resource id (GET/PUT/DELETE /:id) instead rely on the
 * service layer scoping by membership, since the org isn't in the request.
 */
export async function requireOrgMembership(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  if (!req.userId) {
    throw new HttpError(401, "Authentication required");
  }

  const raw =
    typeof req.query.organizationId === "string"
      ? req.query.organizationId
      : typeof req.body?.organizationId === "string"
        ? (req.body.organizationId as string)
        : undefined;

  if (!raw) {
    throw new HttpError(400, "organizationId is required");
  }

  const membership = await assertOrgAccess(req.userId, raw);
  req.organizationId = raw;
  req.orgRole = membership.role;
  next();
}
