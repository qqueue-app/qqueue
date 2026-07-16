import type { Request, Response } from "express";
import { inviteAcceptSchema, inviteCreateSchema } from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { invitationService } from "./service.js";

export const invitationController = {
  // Authenticated (OWNER/ADMIN) — issue an invitation.
  async create(req: Request, res: Response) {
    const input = inviteCreateSchema.parse(req.body);
    const result = await invitationService.create(input, req.userId!);
    res.status(201).json({ data: result });
  },

  // Authenticated (OWNER/ADMIN) — list pending invitations for an org.
  async list(req: Request, res: Response) {
    const organizationId = String(req.query.organizationId);
    const invites = await invitationService.list(organizationId, req.userId!);
    res.json({ data: invites });
  },

  // Authenticated (OWNER/ADMIN) — revoke a pending invitation.
  async revoke(req: Request, res: Response) {
    const invite = await invitationService.revoke(String(req.params.id), req.userId!);
    res.json({ data: invite });
  },

  // Public — preview an invitation from its token (drives the accept page).
  async lookup(req: Request, res: Response) {
    const token = req.query.token;
    if (typeof token !== "string" || token.length === 0) {
      throw new HttpError(400, "token is required");
    }
    const invite = await invitationService.lookup(token);
    res.json({ data: invite });
  },

  // Public — accept an invitation via its emailed token.
  async accept(req: Request, res: Response) {
    const input = inviteAcceptSchema.parse(req.body);
    const result = await invitationService.accept(input);
    res.json({ data: result });
  }
};
