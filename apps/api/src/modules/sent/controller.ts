import type { Request, Response } from "express";
import { sentEmailQuerySchema } from "@qqueue/shared";
import { sentService } from "./service.js";

export const sentController = {
  async list(req: Request, res: Response) {
    const query = sentEmailQuerySchema.parse({
      ...req.query,
      // requireOrgMembership already verified this one; take it from there
      // rather than trusting the query string a second time.
      organizationId: req.organizationId!
    });
    const page = await sentService.list(query, req.userId!);
    res.json({ data: page });
  }
};
