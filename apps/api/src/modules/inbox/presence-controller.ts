import type { Request, Response } from "express";
import { replyPresenceSchema } from "@qqueue/shared";
import { replyPresenceService } from "./presence-service.js";
export const replyPresenceController = {
  async touch(req: Request, res: Response) {
    const { clientId } = replyPresenceSchema.parse(req.body);
    res.json({
      data: await replyPresenceService.touch(
        String(req.params.id),
        req.organizationId!,
        req.userId!,
        clientId
      ),
    });
  },
  async leave(req: Request, res: Response) {
    const { clientId } = replyPresenceSchema.parse(req.body);
    res.json({
      data: await replyPresenceService.leave(
        req.organizationId!,
        req.userId!,
        clientId
      ),
    });
  },
};
