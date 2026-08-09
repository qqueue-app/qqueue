import type { Request, Response } from "express";
import {
  instanceMailDomainCreateSchema,
  instanceMailDomainDeleteSchema,
  instanceMailDomainGrantCreateSchema,
  instanceMailDomainUpdateSchema,
  instanceMuteCreateSchema,
  mailDomainAssignSchema,
} from "@qqueue/shared";
import { instanceAdminService } from "./service.js";

/**
 * Every handler here is instance-scoped: `req.organizationId` is never set,
 * because `requireOrgMembership` deliberately does not run on these routes.
 * `req.userId` is the administrator, used for their personal mutes.
 */
export const instanceAdminController = {
  async listOrganizations(req: Request, res: Response) {
    res.json({
      data: await instanceAdminService.listOrganizations(req.userId as string),
    });
  },

  async getOrganization(req: Request, res: Response) {
    res.json({
      data: await instanceAdminService.getOrganization(
        String(req.params.id),
        req.userId as string
      ),
    });
  },

  async listDomains(req: Request, res: Response) {
    res.json({
      data: await instanceAdminService.listDomains(req.userId as string),
    });
  },

  async createDomain(req: Request, res: Response) {
    const input = instanceMailDomainCreateSchema.parse(req.body);
    res.status(201).json({ data: await instanceAdminService.createDomain(input) });
  },

  async updateDomain(req: Request, res: Response) {
    const input = instanceMailDomainUpdateSchema.parse({
      ...req.body,
      domain: String(req.params.domain),
    });
    res.json({
      data: await instanceAdminService.updateDomain(input, req.userId as string),
    });
  },

  async assignDomain(req: Request, res: Response) {
    const input = mailDomainAssignSchema.parse(req.body);
    res.json({
      data: await instanceAdminService.assignDomain(
        String(req.params.domain),
        input,
        req.userId as string
      ),
    });
  },

  async deleteDomain(req: Request, res: Response) {
    const input = instanceMailDomainDeleteSchema.parse({
      ...req.body,
      domain: String(req.params.domain),
    });
    res.json({ data: await instanceAdminService.deleteDomain(input) });
  },

  async domainDns(req: Request, res: Response) {
    res.json({
      data: await instanceAdminService.dnsStatus(String(req.params.domain)),
    });
  },

  async generateDomainDkim(req: Request, res: Response) {
    res.json({
      data: await instanceAdminService.generateDkim(String(req.params.domain)),
    });
  },

  async listMailboxes(req: Request, res: Response) {
    res.json({
      data: await instanceAdminService.listMailboxes(req.userId as string),
    });
  },

  async listDomainGrants(req: Request, res: Response) {
    const organizationId =
      typeof req.query.organizationId === "string"
        ? req.query.organizationId
        : undefined;
    res.json({
      data: await instanceAdminService.listDomainGrants(organizationId),
    });
  },

  async addDomainGrant(req: Request, res: Response) {
    const input = instanceMailDomainGrantCreateSchema.parse(req.body);
    res.status(201).json({
      data: await instanceAdminService.addDomainGrant(input),
    });
  },

  async removeDomainGrant(req: Request, res: Response) {
    await instanceAdminService.removeDomainGrant(String(req.params.id));
    res.status(204).send();
  },

  async listMutes(req: Request, res: Response) {
    res.json({
      data: await instanceAdminService.listMutes(req.userId as string),
    });
  },

  async addMute(req: Request, res: Response) {
    const input = instanceMuteCreateSchema.parse(req.body);
    res.status(201).json({
      data: await instanceAdminService.addMute(req.userId as string, input),
    });
  },

  async removeMute(req: Request, res: Response) {
    await instanceAdminService.removeMute(
      String(req.params.id),
      req.userId as string
    );
    res.status(204).send();
  },
};
