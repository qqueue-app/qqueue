import type { Request, Response } from "express";
import {
  mailDomainGrantCreateSchema,
  mailboxAdoptSchema,
  mailboxProvisionSchema,
  mailboxSetActiveSchema,
} from "@qqueue/shared";
import { mailcowService } from "./service.js";

export const mailcowController = {
  async status(req: Request, res: Response) {
    res.json({
      data: await mailcowService.status({
        organizationId: req.organizationId!,
        userId: req.userId!,
        role: req.orgRole!,
      }),
    });
  },

  async listMailboxes(req: Request, res: Response) {
    res.json({
      data: await mailcowService.listMailboxes({
        organizationId: req.organizationId!,
        userId: req.userId!,
        role: req.orgRole!,
      }),
    });
  },

  async provision(req: Request, res: Response) {
    const input = mailboxProvisionSchema.parse(req.body);
    const result = await mailcowService.provision(input, {
      userId: req.userId!,
      role: req.orgRole!,
    });
    res.status(201).json({ data: result });
  },

  async adoptMailbox(req: Request, res: Response) {
    const input = mailboxAdoptSchema.parse({
      ...req.body,
      email: req.params.email,
    });
    const result = await mailcowService.adopt(input, {
      userId: req.userId!,
      role: req.orgRole!,
    });
    res.status(201).json({ data: result });
  },

  async resetMailboxPassword(req: Request, res: Response) {
    const result = await mailcowService.resetPassword(
      {
        organizationId: req.organizationId!,
        email: String(req.params.email),
      },
      { userId: req.userId!, role: req.orgRole! }
    );
    res.json({ data: result });
  },

  async setMailboxActive(req: Request, res: Response) {
    const input = mailboxSetActiveSchema.parse({
      ...req.body,
      email: req.params.email,
    });
    const result = await mailcowService.setActive(input, {
      userId: req.userId!,
      role: req.orgRole!,
    });
    res.json({ data: result });
  },

  async deleteMailbox(req: Request, res: Response) {
    const result = await mailcowService.remove(
      {
        organizationId: req.organizationId!,
        email: String(req.params.email),
      },
      { userId: req.userId!, role: req.orgRole! }
    );
    res.json({ data: result });
  },

  async listDomainGrants(req: Request, res: Response) {
    res.json({
      data: await mailcowService.listDomainGrants(req.organizationId!),
    });
  },

  async addDomainGrant(req: Request, res: Response) {
    const input = mailDomainGrantCreateSchema.parse(req.body);
    const grant = await mailcowService.addDomainGrant({
      organizationId: req.organizationId!,
      userId: input.userId,
      domain: input.domain,
    });
    res.status(201).json({ data: grant });
  },

  async removeDomainGrant(req: Request, res: Response) {
    await mailcowService.removeDomainGrant(
      String(req.params.id),
      req.organizationId!
    );
    res.status(204).send();
  },
};
