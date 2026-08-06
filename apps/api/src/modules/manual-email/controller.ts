import type { Request, Response } from "express";
import { emailPreviewSchema, manualEmailSendSchema } from "@qqueue/shared";
import { logger } from "../../lib/logger.js";
import { manualEmailService } from "./service.js";

export const manualEmailController = {
  async send(req: Request, res: Response) {
    const input = manualEmailSendSchema.parse(req.body);
    const result = await manualEmailService.send(input, req.userId!);
    // Correlates this request's log lines with the worker's jobs (Phase 5).
    logger.info(
      {
        reqId: req.id,
        organizationId: req.organizationId,
        userId: req.userId,
        emailJobId: result.id
      },
      "manual send accepted"
    );
    res.status(202).json({ data: result });
  },

  async preview(req: Request, res: Response) {
    const input = emailPreviewSchema.parse(req.body);
    const result = await manualEmailService.preview(input);
    res.json({ data: result });
  },

  async recipientSuggestions(req: Request, res: Response) {
    // organizationId is verified and pinned by requireOrgMembership (query).
    const suggestions = await manualEmailService.recentRecipients(
      req.organizationId!
    );
    res.json({ data: suggestions });
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
