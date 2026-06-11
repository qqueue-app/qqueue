import type {
  CampaignInput,
  CampaignRecurrenceInput,
  CampaignScheduleInput,
  CampaignUpdateInput
} from "@qqueue/shared";
import { nextCronRun } from "../../lib/cron.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { campaignProcessingQueue } from "../../queues/campaign-processing.queue.js";

function recurringSchedulerId(campaignId: string) {
  return `campaign-recurring-${campaignId}`;
}

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

async function enqueueCampaign(
  campaignId: string,
  occurrenceKey: string,
  scheduledAt?: Date | null
) {
  const delay = scheduledAt
    ? Math.max(0, scheduledAt.getTime() - Date.now())
    : undefined;

  await campaignProcessingQueue.add(
    "process-campaign",
    { campaignId, occurrenceKey },
    {
      delay,
      jobId: `campaign-${campaignId}-${occurrenceKey}`,
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
        templateId: input.templateId,
        contactListId: input.contactListId,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined
      },
      include: campaignInclude
    });
  },

  async duplicate(id: string, userId: string) {
    const existing = await findOwned(id, userId);

    return prisma.campaign.create({
      data: {
        organizationId: existing.organizationId,
        name: `Copy of ${existing.name}`,
        templateId: existing.templateId,
        contactListId: existing.contactListId
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

    await enqueueCampaign(id, `manual-${Date.now()}`);
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
      data: {
        status: "SCHEDULED",
        scheduledAt,
        cronExpression: null,
        timezone: null,
        nextRunAt: scheduledAt
      },
      include: campaignInclude
    });

    await enqueueCampaign(
      id,
      `scheduled-${scheduledAt.toISOString()}`,
      scheduledAt
    );
    return updated;
  },

  async setRecurrence(
    id: string,
    userId: string,
    input: CampaignRecurrenceInput
  ) {
    const campaign = await findOwned(id, userId);

    if (!["DRAFT", "SCHEDULED", "PAUSED"].includes(campaign.status)) {
      throw new HttpError(
        400,
        "Recurrence can only be set on draft, scheduled, or paused campaigns"
      );
    }

    if (!campaign.templateId || !campaign.contactListId) {
      throw new HttpError(400, "Campaign requires a template and contact list");
    }

    const nextRunAt = nextCronRun(input.cronExpression, input.timezone);
    if (!nextRunAt) {
      throw new HttpError(400, "Invalid cron expression or timezone");
    }

    const updated = await prisma.campaign.update({
      where: { id },
      data: {
        status: "SCHEDULED",
        scheduledAt: null,
        cronExpression: input.cronExpression,
        timezone: input.timezone,
        nextRunAt
      },
      include: campaignInclude
    });

    await campaignProcessingQueue.upsertJobScheduler(
      recurringSchedulerId(id),
      { pattern: input.cronExpression, tz: input.timezone },
      {
        name: "process-campaign",
        data: { campaignId: id },
        opts: { attempts: 3, backoff: { type: "exponential", delay: 30_000 } }
      }
    );

    return updated;
  },

  async pause(id: string, userId: string) {
    const campaign = await findOwned(id, userId);

    if (!["SCHEDULED", "SENDING"].includes(campaign.status)) {
      throw new HttpError(
        400,
        "Only scheduled or sending campaigns can be paused"
      );
    }

    if (campaign.cronExpression) {
      await campaignProcessingQueue.removeJobScheduler(
        recurringSchedulerId(id)
      );
    }

    return prisma.campaign.update({
      where: { id },
      data: { status: "PAUSED", nextRunAt: null },
      include: campaignInclude
    });
  },

  async analytics(id: string, userId: string) {
    const campaign = await findOwned(id, userId);
    const where = { emailJob: { campaignId: id } };

    const [
      recipients,
      sent,
      failed,
      byType,
      uniqueOpens,
      uniqueClicks,
      clickEvents,
      recentEvents
    ] = await Promise.all([
      prisma.emailJob.count({ where: { campaignId: id } }),
      prisma.emailJob.count({ where: { campaignId: id, status: "SENT" } }),
      prisma.emailJob.count({ where: { campaignId: id, status: "FAILED" } }),
      prisma.emailEvent.groupBy({
        by: ["type"],
        where,
        _count: { _all: true }
      }),
      prisma.emailEvent.groupBy({ by: ["emailJobId"], where: { ...where, type: "OPENED" } }),
      prisma.emailEvent.groupBy({ by: ["emailJobId"], where: { ...where, type: "CLICKED" } }),
      prisma.emailEvent.findMany({
        where: { ...where, type: "CLICKED" },
        select: { metadata: true }
      }),
      prisma.emailEvent.findMany({
        where,
        select: {
          id: true,
          type: true,
          occurredAt: true,
          emailJob: { select: { toEmail: true } }
        },
        orderBy: { occurredAt: "desc" },
        take: 15
      })
    ]);

    const counts = Object.fromEntries(
      byType.map((row: { type: string; _count: { _all: number } }) => [
        row.type,
        row._count._all
      ])
    ) as Partial<Record<string, number>>;

    const opened = counts.OPENED ?? 0;
    const clicked = counts.CLICKED ?? 0;
    const bounced = counts.BOUNCED ?? 0;
    const uniqueOpened = uniqueOpens.length;
    const uniqueClicked = uniqueClicks.length;

    // Per-link click breakdown from CLICKED event metadata.
    const linkCounts = new Map<string, number>();
    for (const event of clickEvents) {
      const url = (event.metadata as { url?: string } | null)?.url;
      if (url) {
        linkCounts.set(url, (linkCounts.get(url) ?? 0) + 1);
      }
    }
    const links = [...linkCounts.entries()]
      .map(([url, clicks]) => ({ url, clicks }))
      .sort((a, b) => b.clicks - a.clicks);

    const rate = (value: number, total: number) =>
      total > 0 ? value / total : 0;

    return {
      campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
      totals: {
        recipients,
        sent,
        failed,
        delivered: counts.DELIVERED ?? 0,
        opened,
        uniqueOpened,
        clicked,
        uniqueClicked,
        bounced,
        complained: counts.COMPLAINED ?? 0
      },
      rates: {
        open: rate(uniqueOpened, sent),
        click: rate(uniqueClicked, sent),
        bounce: rate(bounced, recipients)
      },
      links,
      recentEvents: recentEvents.map(
        (event: {
          id: string;
          type: string;
          occurredAt: Date;
          emailJob: { toEmail: string };
        }) => ({
          id: event.id,
          type: event.type,
          occurredAt: event.occurredAt.toISOString(),
          toEmail: event.emailJob.toEmail
        })
      )
    };
  },

  async resume(id: string, userId: string) {
    const campaign = await findOwned(id, userId);

    if (campaign.status !== "PAUSED") {
      throw new HttpError(400, "Only paused campaigns can be resumed");
    }

    if (campaign.cronExpression) {
      const nextRunAt = nextCronRun(
        campaign.cronExpression,
        campaign.timezone
      );

      await campaignProcessingQueue.upsertJobScheduler(
        recurringSchedulerId(id),
        { pattern: campaign.cronExpression, tz: campaign.timezone ?? "UTC" },
        {
          name: "process-campaign",
          data: { campaignId: id },
          opts: {
            attempts: 3,
            backoff: { type: "exponential", delay: 30_000 }
          }
        }
      );

      return prisma.campaign.update({
        where: { id },
        data: { status: "SCHEDULED", nextRunAt },
        include: campaignInclude
      });
    }

    // One-shot campaign: resume into its prior phase so deferred email jobs
    // (held by the email worker while paused) continue automatically.
    const stillScheduled =
      campaign.scheduledAt && campaign.scheduledAt.getTime() > Date.now();

    return prisma.campaign.update({
      where: { id },
      data: {
        status: stillScheduled ? "SCHEDULED" : "SENDING",
        nextRunAt: stillScheduled ? campaign.scheduledAt : null
      },
      include: campaignInclude
    });
  }
};
