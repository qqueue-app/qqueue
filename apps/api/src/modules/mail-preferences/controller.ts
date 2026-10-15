import type { Request, Response } from "express";
import { mailSignatureSchema } from "@qqueue/shared";
import { mailPreferenceService } from "./service.js";
export const mailPreferenceController = {
  async signatures(req: Request, res: Response) {
    res.json({
      data: await mailPreferenceService.signatures(
        req.organizationId!,
        req.userId!
      ),
    });
  },
  async saveSignature(req: Request, res: Response) {
    const input = mailSignatureSchema.parse(req.body);
    const saved = await mailPreferenceService.saveSignature(
      req.organizationId!,
      req.userId!,
      input
    );
    res.json({
      data: {
        revision: saved.revision,
        text: saved.text,
        enabled: saved.enabled,
        smtpConnectionId: saved.smtpConnectionId,
      },
    });
  },
};
