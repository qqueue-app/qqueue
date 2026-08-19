import type {
  AbTestConfigInput,
  CampaignInput,
  CampaignRecurrenceInput,
  CampaignScheduleInput,
  CampaignUpdateInput
} from "@qqueue/shared";
import { nextCronRun } from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import {
  campaignScope,
  mayUseConnection,
  resolveMailboxAccess
} from "../../lib/mailbox-access.js";
import { prisma } from "../../lib/prisma.js";
import { assertMayUseConnection } from "../../lib/send-as.js";
import { campaignProcessingQueue } from "../../queues/campaign-processing.queue.js";

function recurringSchedulerId(campaignId: string) {
  return `campaign-recurring-${campaignId}`;
}

/**
 * Campaign fan-out sends as the account the campaign names, or as the org's
 * default when it names none (resolved in the worker). Send-as enforcement
 * (Phase 4) therefore happens when the campaign is started: the actor must be
 * allowed to use whichever of the two this campaign will actually use. The
 * worker does not re-verify at fire time.
 */
async function assertMayStartCampaign(campaign: {
  organizationId: string;
  smtpConnectionId: string | null;
}, userId: string) {
  await assertMayUseConnection({
    userId,
    organizationId: campaign.organizationId,
    smtpConnectionId: campaign.smtpConnectionId
  });
}

/**
 * Whether one campaign exists at all for this person.
 *
 * A campaign has no mailbox of its own beyond the account it sends as, so
 * "may a member see this campaign" has the same answer as "may they send as
 * its account", the check that already guards starting one. Someone who could
 * never start it has no reason to read its audience, copy and results.
 */
async function campaignVisibleTo(
  userId: string,
  campaign: { organizationId: string; smtpConnectionId: string | null }
) {
  const access = await resolveMailboxAccess(userId, campaign.organizationId);
  return mayUseConnection(access, campaign.smtpConnectionId);
}

const campaignInclude = {
  template: {
    select: { id: true, name: true, subject: true }
  },
  contactList: {
    select: { id: true, name: true, _count: { select: { members: true } } }
  },
  // Named so the list can say which account a campaign sends as without a
  // second request per row. Absent (NULL) means the org default, which the
  // client resolves against the accounts it already loads.
  smtpConnection: {
    select: { id: true, name: true, fromEmail: true, fromName: true }
  },
  segment: {
    select: { id: true, name: true }
  },
  variants: {
    orderBy: { label: "asc" as const }
  },
  _count: { select: { emailJobs: true } }
};

async function assertCampaignRelations(input: {
  organizationId: string;
  templateId?: string | null;
  smtpConnectionId?: string | null;
  contactListId?: string | null;
  segmentId?: string | null;
}) {
  if (input.smtpConnectionId) {
    const connection = await prisma.sMTPConnection.findFirst({
      where: {
        id: input.smtpConnectionId,
        organizationId: input.organizationId
      },
      select: { id: true }
    });
    if (!connection) {
      throw new HttpError(404, "Sending account not found");
    }
  }

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

  if (input.segmentId) {
    const segment = await prisma.segment.findFirst({
      where: { id: input.segmentId, organizationId: input.organizationId },
      select: { id: true }
    });
    if (!segment) {
      throw new HttpError(404, "Segment not found");
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
  // Every campaign operation but list/get/create funnels through here, so this
  // is the one place the visibility rule has to hold. 404 rather than 403: the
  // campaign is not in this member's world at all, which is also what the empty
  // list tells them.
  if (!(await campaignVisibleTo(userId, campaign))) {
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
  async list(organizationId: string, userId: string) {
    const access = await resolveMailboxAccess(userId, organizationId);
    // Scoped in the query rather than filtered afterwards: with per-campaign
    // accounts, visibility varies row by row, and a post-filter would resolve
    // the same two grant facts once per campaign.
    return prisma.campaign.findMany({
      where: { organizationId, ...(await campaignScope(access)) },
      include: campaignInclude,
      orderBy: { createdAt: "desc" }
    });
  },

  async get(id: string, userId: string) {
    const campaign = await prisma.campaign.findFirst({
      where: { id, organization: { members: { some: { userId } } } },
      include: campaignInclude
    });
    if (!campaign) return null;
    if (!(await campaignVisibleTo(userId, campaign))) {
      return null;
    }
    return campaign;
  },

  async create(input: CampaignInput, userId: string) {
    // Creation is gated with the rest: letting a member create a campaign they
    // would then never see in the list is worse than refusing outright. Gated
    // on the account this campaign will send as, so picking one you may use is
    // allowed even when the org default is not yours.
    const smtpConnectionId = input.smtpConnectionId ?? null;
    const access = await resolveMailboxAccess(userId, input.organizationId);
    if (!(await mayUseConnection(access, smtpConnectionId))) {
      throw new HttpError(
        403,
        "You are not allowed to send campaigns from this account",
        "send_as_denied"
      );
    }
    await assertCampaignRelations({ ...input, smtpConnectionId });

    return prisma.campaign.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        templateId: input.templateId,
        smtpConnectionId,
        contactListId: input.contactListId,
        segmentId: input.segmentId,
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
      smtpConnectionId: input.smtpConnectionId,
      contactListId: input.contactListId,
      segmentId: input.segmentId
    });

    /*
      Moving a campaign onto an account is a send-as decision, so it is gated
      like one — otherwise a member could create a campaign on an account they
      hold and then edit it onto one they don't. `undefined` leaves the account
      alone and needs no check; `null` returns it to the org default, which is
      itself a connection someone may or may not hold.
    */
    if (input.smtpConnectionId !== undefined) {
      const access = await resolveMailboxAccess(userId, existing.organizationId);
      if (!(await mayUseConnection(access, input.smtpConnectionId))) {
        throw new HttpError(
          403,
          "You are not allowed to send campaigns from this account",
          "send_as_denied"
        );
      }
    }

    // Targeting a segment clears any existing contact list and vice versa, so a
    // campaign never ends up pointing at both.
    const targetUpdate =
      input.segmentId !== undefined
        ? { segmentId: input.segmentId, contactListId: null }
        : input.contactListId !== undefined
          ? { contactListId: input.contactListId, segmentId: null }
          : {};

    return prisma.campaign.update({
      where: { id },
      data: {
        name: input.name,
        templateId: input.templateId,
        // Explicit null is a real value here — "go back to the org default" —
        // so it must survive as null rather than being coalesced away.
        smtpConnectionId: input.smtpConnectionId,
        ...targetUpdate,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined
      },
      include: campaignInclude
    });
  },

  /**
   * Configure (or disable) A/B subject testing on a draft campaign. Replaces any
   * existing variants. Disabling clears the config and removes variants.
   */
  async configureAbTest(id: string, userId: string, input: AbTestConfigInput) {
    const existing = await findOwned(id, userId);
    if (existing.status !== "DRAFT") {
      throw new HttpError(400, "A/B testing can only be configured on a draft");
    }

    if (!input.enabled) {
      await prisma.$transaction([
        prisma.campaignVariant.deleteMany({ where: { campaignId: id } }),
        prisma.campaign.update({
          where: { id },
          data: {
            abTestEnabled: false,
            abTestPercent: null,
            abWinnerMetric: null,
            abTestWindowMin: null,
            abTestStatus: null
          }
        })
      ]);
      return this.get(id, userId);
    }

    await prisma.$transaction([
      prisma.campaignVariant.deleteMany({ where: { campaignId: id } }),
      prisma.campaign.update({
        where: { id },
        data: {
          abTestEnabled: true,
          abTestPercent: input.percent,
          abWinnerMetric: input.metric,
          abTestWindowMin: input.windowMin,
          abTestStatus: null,
          variants: {
            create: input.variants!.map((variant) => ({
              label: variant.label,
              subject: variant.subject
            }))
          }
        }
      })
    ]);
    return this.get(id, userId);
  },

  /**
   * Copy a campaign as a fresh draft: audience (list or segment) and A/B
   * configuration travel with it; run state (abTestStatus, winner flags,
   * schedules) deliberately does not.
   */
  async duplicate(id: string, userId: string) {
    const existing = await findOwned(id, userId);
    const variants = await prisma.campaignVariant.findMany({
      where: { campaignId: id },
      select: { label: true, subject: true },
      orderBy: { label: "asc" }
    });

    return prisma.campaign.create({
      data: {
        organizationId: existing.organizationId,
        name: `Copy of ${existing.name}`,
        templateId: existing.templateId,
        // The copy sends as whatever the original did; findOwned has already
        // established this actor may see (and so may send as) that account.
        smtpConnectionId: existing.smtpConnectionId,
        contactListId: existing.contactListId,
        segmentId: existing.segmentId,
        abTestEnabled: existing.abTestEnabled,
        abTestPercent: existing.abTestPercent,
        abWinnerMetric: existing.abWinnerMetric,
        abTestWindowMin: existing.abTestWindowMin,
        ...(variants.length > 0 ? { variants: { create: variants } } : {})
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

    // Phase 5: a segment is a first-class audience — the worker has resolved
    // segments since Phase D, but these guards predated that and locked
    // segment-targeted campaigns out of ever starting.
    if (!campaign.templateId || (!campaign.contactListId && !campaign.segmentId)) {
      throw new HttpError(
        400,
        "Campaign requires a template and an audience (contact list or segment)"
      );
    }

    await assertMayStartCampaign(campaign, userId);

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

    // Phase 5: a segment is a first-class audience — the worker has resolved
    // segments since Phase D, but these guards predated that and locked
    // segment-targeted campaigns out of ever starting.
    if (!campaign.templateId || (!campaign.contactListId && !campaign.segmentId)) {
      throw new HttpError(
        400,
        "Campaign requires a template and an audience (contact list or segment)"
      );
    }

    await assertMayStartCampaign(campaign, userId);

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

    // Phase 5: a segment is a first-class audience — the worker has resolved
    // segments since Phase D, but these guards predated that and locked
    // segment-targeted campaigns out of ever starting.
    if (!campaign.templateId || (!campaign.contactListId && !campaign.segmentId)) {
      throw new HttpError(
        400,
        "Campaign requires a template and an audience (contact list or segment)"
      );
    }

    await assertMayStartCampaign(campaign, userId);

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
      confirmedDeliveries,
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
      // Distinct jobs with a DELIVERED event from a source that observes
      // delivery. A bare DELIVERED is not enough: the open pixel used to
      // synthesize one, so counting every DELIVERED reported the open rate.
      prisma.emailEvent.groupBy({
        by: ["emailJobId"],
        where: {
          ...where,
          type: "DELIVERED",
          OR: [
            { metadata: { path: ["source"], equals: "webhook" } },
            { metadata: { path: ["source"], equals: "dsn" } }
          ]
        }
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

    // Per-variant open/click breakdown for A/B campaigns (empty otherwise).
    const variants = await prisma.campaignVariant.findMany({
      where: { campaignId: id },
      orderBy: { label: "asc" }
    });
    const variantBreakdown = await Promise.all(
      variants.map(async (variant) => {
        const [variantSent, variantOpens, variantClicks] = await Promise.all([
          prisma.emailJob.count({
            where: { campaignId: id, variantId: variant.id }
          }),
          prisma.emailEvent.groupBy({
            by: ["emailJobId"],
            where: { type: "OPENED", emailJob: { variantId: variant.id } }
          }),
          prisma.emailEvent.groupBy({
            by: ["emailJobId"],
            where: { type: "CLICKED", emailJob: { variantId: variant.id } }
          })
        ]);
        return {
          id: variant.id,
          label: variant.label,
          subject: variant.subject,
          isWinner: variant.isWinner,
          sent: variantSent,
          uniqueOpened: variantOpens.length,
          uniqueClicked: variantClicks.length,
          openRate: rate(variantOpens.length, variantSent),
          clickRate: rate(variantClicks.length, variantSent)
        };
      })
    );

    return {
      campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
      totals: {
        recipients,
        sent,
        failed,
        confirmedDelivered: confirmedDeliveries.length,
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
      variantBreakdown,
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
