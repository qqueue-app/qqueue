import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";

/**
 * Instance-admin gate for install-scope endpoints (instance settings, env
 * status). Runs after requireAuth, so req.userId is set. Distinct from org
 * OWNER: any user can create an org and own it, but only instance admins may
 * change how the whole server behaves.
 */
export async function requireInstanceAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const user = await prisma.user.findUnique({
    where: { id: req.userId as string },
    select: { isInstanceAdmin: true }
  });
  if (!user?.isInstanceAdmin) {
    throw new HttpError(403, "Instance administrator access required");
  }
  next();
}
