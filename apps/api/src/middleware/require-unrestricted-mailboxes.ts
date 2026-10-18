import type { Request, Response, NextFunction } from "express";
import { assertNoMailboxRestrictions } from "../lib/mailbox-access.js";

export async function requireUnrestrictedMailboxes(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  await assertNoMailboxRestrictions(req.userId!, req.organizationId!);
  next();
}
