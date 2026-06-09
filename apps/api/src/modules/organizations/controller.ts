import type { Request, Response } from "express";
import { organizationSchema } from "@qqueue/shared";
import { organizationService } from "./service.js";

export const organizationController = {
  async list(_req: Request, res: Response) {
    const organizations = await organizationService.list();
    res.json({ data: organizations });
  },

  async get(req: Request, res: Response) {
    const organization = await organizationService.get(String(req.params.id));

    if (!organization) {
      res.status(404).json({ error: { message: "Organization not found" } });
      return;
    }

    res.json({ data: organization });
  },

  async create(req: Request, res: Response) {
    const input = organizationSchema.parse(req.body);
    const organization = await organizationService.create(input);
    res.status(201).json({ data: organization });
  },

  async update(req: Request, res: Response) {
    const input = organizationSchema.parse(req.body);
    const organization = await organizationService.update(
      String(req.params.id),
      input
    );
    res.json({ data: organization });
  },

  async delete(req: Request, res: Response) {
    await organizationService.delete(String(req.params.id));
    res.status(204).send();
  }
};
