import type { Request, Response } from "express";
import {
  campaignRecurrenceSchema,
  campaignScheduleSchema,
  campaignSchema,
  campaignUpdateSchema
} from "@qqueue/shared";
import { campaignService } from "./service.js";

export const campaignController = {
  async list(req: Request, res: Response) {
    const campaigns = await campaignService.list(req.organizationId!);
    res.json({ data: campaigns });
  },

  async get(req: Request, res: Response) {
    const campaign = await campaignService.get(
      String(req.params.id),
      req.userId!
    );

    if (!campaign) {
      res.status(404).json({ error: { message: "Campaign not found" } });
      return;
    }

    res.json({ data: campaign });
  },

  async create(req: Request, res: Response) {
    const input = campaignSchema.parse(req.body);
    const campaign = await campaignService.create(input);
    res.status(201).json({ data: campaign });
  },

  async update(req: Request, res: Response) {
    const input = campaignUpdateSchema.parse(req.body);
    const campaign = await campaignService.update(
      String(req.params.id),
      req.userId!,
      input
    );
    res.json({ data: campaign });
  },

  async duplicate(req: Request, res: Response) {
    const campaign = await campaignService.duplicate(
      String(req.params.id),
      req.userId!
    );
    res.status(201).json({ data: campaign });
  },

  async delete(req: Request, res: Response) {
    await campaignService.delete(String(req.params.id), req.userId!);
    res.status(204).send();
  },

  async sendNow(req: Request, res: Response) {
    const campaign = await campaignService.sendNow(
      String(req.params.id),
      req.userId!
    );
    res.json({ data: campaign });
  },

  async schedule(req: Request, res: Response) {
    const input = campaignScheduleSchema.parse(req.body);
    const campaign = await campaignService.schedule(
      String(req.params.id),
      req.userId!,
      input
    );
    res.json({ data: campaign });
  },

  async setRecurrence(req: Request, res: Response) {
    const input = campaignRecurrenceSchema.parse(req.body);
    const campaign = await campaignService.setRecurrence(
      String(req.params.id),
      req.userId!,
      input
    );
    res.json({ data: campaign });
  },

  async pause(req: Request, res: Response) {
    const campaign = await campaignService.pause(
      String(req.params.id),
      req.userId!
    );
    res.json({ data: campaign });
  },

  async resume(req: Request, res: Response) {
    const campaign = await campaignService.resume(
      String(req.params.id),
      req.userId!
    );
    res.json({ data: campaign });
  }
};
