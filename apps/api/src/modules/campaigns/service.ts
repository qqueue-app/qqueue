import type {
  CampaignInput,
  CampaignScheduleInput,
  CampaignUpdateInput
} from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { campaignProcessingQueue } from "../../queues/campaign-processing.queue.js";

const campaignInclude = {
  template: {
    select: { id: true, name: true, subject: true }
  },
  contactList: {
    select: { id: true, name: true, _count: { select: { contacts: true } } }
  },
  _count: { select: { emailJobs: true } }
};

async function assertCampaignRelations(input: {
  organizationId: string;
  templateId?: string | null;
  contactListId?: string | null;
}) {
  if (input.templateId) {
    const template = await prisma.template.findFirst({
      where: { id: input.templateId, organizationId: input.organizationId },
      select: { id: true }
    });
    if (!template) {
      throw new HttpError(404, "Template not found");
    }
  }

  if (input.contactListId) {
    const contactList = await prisma.contactList.findFirst({
      where: { id: input.contactListId, organizationId: input.organizationId },
      select: { id: true }
    });
    if (!contactList) {
      throw new HttpError(404, "Contact list not found");
    }
  }
}

async function findOwned(id: string, userId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, organization: { members: { some: { userId } } } }
  });
  if (!campaign) {
    throw new HttpError(404, "Campaign not found");
  }
  return campaign;
}

async function enqueueCampaign(campaignId: string, scheduledAt?: Date | null) {
  const delay = scheduledAt
    ? Math.max(0, scheduledAt.getTime() - Date.now())
    : undefined;

  await campaignProcessingQueue.add(
    "process-campaign",
    { campaignId },
    {
      delay,
      jobId: `campaign-${campaignId}-${scheduledAt?.toISOString() ?? "now"}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 }
    }
  );
}

export const campaignService = {
  list(organizationId: string) {
    return prisma.campaign.findMany({
      where: { organizationId },
      include: campaignInclude,
      orderBy: { createdAt: "desc" }
    });
  },

  get(id: string, userId: string) {
    return prisma.campaign.findFirst({
      where: { id, organization: { members: { some: { userId } } } },
      include: campaignInclude
    });
  },

  async create(input: CampaignInput) {
    await assertCampaignRelations(input);

    return prisma.campaign.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        subject: input.subject,
        templateId: input.templateId,
        contactListId: input.contactListId,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined
      },
      include: campaignInclude
    });
  },

  async update(id: string, userId: string, input: CampaignUpdateInput) {
    const existing = await findOwned(id, userId);

    if (existing.status !== "DRAFT") {
      throw new HttpError(400, "Only draft campaigns can be edited");
    }

    await assertCampaignRelations({
      organizationId: existing.organizationId,
      templateId: input.templateId,
      contactListId: input.contactListId
    });

    return prisma.campaign.update({
      where: { id },
      data: {
        name: input.name,
        subject: input.subject,
        templateId: input.templateId,
        contactListId: input.contactListId,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined
      },
      include: campaignInclude
    });
  },

  async delete(id: string, userId: string) {
    const campaign = await findOwned(id, userId);

    if (!["DRAFT", "CANCELLED"].includes(campaign.status)) {
      throw new HttpError(400, "Only draft or cancelled campaigns can be deleted");
    }

    await prisma.campaign.delete({ where: { id } });
  },

  async sendNow(id: string, userId: string) {
    const campaign = await findOwned(id, userId);

    if (!["DRAFT", "SCHEDULED"].includes(campaign.status)) {
      throw new HttpError(400, "Campaign cannot be sent from its current status");
    }

    if (!campaign.templateId || !campaign.contactListId) {
      throw new HttpError(400, "Campaign requires a template and contact list");
    }

    const updated = await prisma.campaign.update({
      where: { id },
      data: { status: "SENDING", scheduledAt: null },
      include: campaignInclude
    });

    await enqueueCampaign(id);
    return updated;
  },

  async schedule(id: string, userId: string, input: CampaignScheduleInput) {
    const campaign = await findOwned(id, userId);

    if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
      throw new HttpError(400, "Only draft or scheduled campaigns can be scheduled");
    }

    if (!campaign.templateId || !campaign.contactListId) {
      throw new HttpError(400, "Campaign requires a template and contact list");
    }

    const scheduledAt = new Date(input.scheduledAt);
    if (scheduledAt.getTime() <= Date.now()) {
      throw new HttpError(400, "scheduledAt must be in the future");
    }

    const updated = await prisma.campaign.update({
      where: { id },
      data: { status: "SCHEDULED", scheduledAt },
      include: campaignInclude
    });

    await enqueueCampaign(id, scheduledAt);
    return updated;
  }
};
