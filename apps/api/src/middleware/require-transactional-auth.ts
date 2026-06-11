import type { NextFunction, Request, Response } from "express";
import { apiKeyService } from "../modules/api-keys/service.js";
import { assertOrgAccess } from "../lib/org-access.js";
import { HttpError } from "../lib/http-error.js";
import { verifyAccessToken } from "../lib/tokens.js";

function getBearerToken(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "Authentication required");
  }

  return header.slice("Bearer ".length).trim();
}

/**
 * Transactional sends are allowed from either the dashboard JWT flow or the
 * public developer API key flow. API keys bind directly to an organization.
 */
export async function requireTransactionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const token = getBearerToken(req);

  if (token.startsWith("qq_live_")) {
    const apiKey = await apiKeyService.authenticate(token);
    if (!apiKey) {
      throw new HttpError(401, "Invalid API key", "invalid_api_key");
    }

    req.apiKeyId = apiKey.id;
    req.organizationId = apiKey.organizationId;
    next();
    return;
  }

  const payload = verifyAccessToken(token);
  req.userId = payload.sub;
  req.userEmail = payload.email;

  const organizationId =
    typeof req.body?.organizationId === "string"
      ? (req.body.organizationId as string)
      : undefined;

  if (!organizationId) {
    throw new HttpError(400, "organizationId is required");
  }

  const membership = await assertOrgAccess(req.userId, organizationId);
  req.organizationId = organizationId;
  req.orgRole = membership.role;
  next();
}
