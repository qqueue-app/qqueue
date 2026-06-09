import type { Request, Response } from "express";
import { contactSchema } from "@qqueue/shared";
import { contactService } from "./service.js";

export const contactController = {
  async list(req: Request, res: Response) {
    // organizationId is verified and pinned by requireOrgMembership.
    const contacts = await contactService.list(req.organizationId!);
    res.json({ data: contacts });
  },

  async get(req: Request, res: Response) {
    const contact = await contactService.get(
      String(req.params.id),
      req.userId!
    );

    if (!contact) {
      res.status(404).json({ error: { message: "Contact not found" } });
      return;
    }

    res.json({ data: contact });
  },

  async create(req: Request, res: Response) {
    const input = contactSchema.parse(req.body);
    const contact = await contactService.create(input);
    res.status(201).json({ data: contact });
  },

  async update(req: Request, res: Response) {
    const input = contactSchema.parse(req.body);
    const contact = await contactService.update(
      String(req.params.id),
      req.userId!,
      input
    );
    res.json({ data: contact });
  },

  async delete(req: Request, res: Response) {
    await contactService.delete(String(req.params.id), req.userId!);
    res.status(204).send();
  }
};
