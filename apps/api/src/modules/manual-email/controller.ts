import type { Request, Response } from "express";
import { emailPreviewSchema, manualEmailSendSchema } from "@qqueue/shared";
import { manualEmailService } from "./service.js";

export const manualEmailController = {
  async send(req: Request, res: Response) {
    const input = manualEmailSendSchema.parse(req.body);
    const result = await manualEmailService.send(input, req.userId!);
    res.status(202).json({ data: result });
  },

  async preview(req: Request, res: Response) {
    const input = emailPreviewSchema.parse(req.body);
    const result = await manualEmailService.preview(input);
    res.json({ data: result });
  },

  async status(req: Request, res: Response) {
    // organizationId is verified and pinned by requireOrgMembership (query).
    const result = await manualEmailService.deliveryStatus(
      String(req.params.emailJobId),
      req.organizationId!
    );
    res.json({ data: result });
  }
};
