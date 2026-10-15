import type { Request, Response } from "express";
import { mailSearchSchema } from "@qqueue/shared";
import { sentService } from "../sent/service.js";
import { mailSearchService } from "./service.js";
export const mailSearchController = {
  async outgoing(req: Request, res: Response) {
    res.json({
      data: await sentService.get(
        String(req.params.id),
        req.organizationId!,
        req.userId!,
        true
      ),
    });
  },
  async search(req: Request, res: Response) {
    res.json({
      data: await mailSearchService.search(
        req.organizationId!,
        req.userId!,
        mailSearchSchema.parse(req.query)
      ),
    });
  },
  async mailboxes(req: Request, res: Response) {
    res.json({
      data: await mailSearchService.mailboxes(req.organizationId!, req.userId!),
    });
  },
};
