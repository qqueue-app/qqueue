import { Worker } from "bullmq";
import { type SegmentRule, compileSegmentRules } from "@qqueue/shared";
import type { Prisma } from "@prisma/client";
import { redisConnection } from "../config/redis.js";
import { emailSendingQueue } from "../queues/email-sending.queue.js";
import {
  campaignProcessingQueue,
  type CampaignProcessingJob
} from "../queues/campaign-processing.queue.js";
import { settleRunIfComplete } from "../lib/campaign-run.js";
import { prisma } from "../lib/prisma.js";

function renderVariables(
  value: string | null | undefined,
  variables: Record<string, unknown>
) {
  if (!value) {
    return undefined;
  }

  return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    const variable = variables[key];
    return variable === undefined || variable === null ? "" : String(variable);
  });
}

function contactVariables(contact: {
  email: string;
  firstName: string | null;
  lastName: string | null;
}) {
  return {
    email: contact.email,
    firstName: contact.firstName ?? "",
    lastName: contact.lastName ?? ""
  };
}

function enqueueEmailJobs(emailJobIds: string[]) {
  if (emailJobIds.length === 0) {
    return Promise.resolve([]);
  }
  return emailSendingQueue.addBulk(
    emailJobIds.map((emailJobId) => ({
      name: "send-email",
      data: { emailJobId },
      opts: {
        jobId: `email-${emailJobId}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 }
      }
    }))
  );
}

interface ResolvableCampaign {
  id: string;
  organizationId: string;
  templateId: string | null;
  abTestWindowMin: number | null;
}

/** Schedule the delayed A/B decision job (idempotent via a stable job id). */
function scheduleAbDecision(campaign: ResolvableCampaign, occurrenceKey: string) {
  return campaignProcessingQueue.add(
    "decide-ab-test",
    { campaignId: campaign.id, occurrenceKey, phase: "decide" as const },
    {
      delay: (campaign.abTestWindowMin ?? 60) * 60_000,
      jobId: `campaign-${campaign.id}-${occurrenceKey}-decide`
    }
  );
}

export function startCampaignProcessingWorker() {
  return new Worker<CampaignProcessingJob>(
    "campaign-processing",
    async (job) => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: job.data.campaignId },
        include: {
          template: true,
          segment: true,
          variants: true,
          contactList: {
            include: {
              members: {
                where: { contact: { status: "ACTIVE" } },
                include: { contact: true },
                orderBy: { contact: { createdAt: "asc" } }
              }
            }
          }
        }
      });

      // Cancelled or paused campaigns must not produce sends. (For recurring
      // campaigns, pausing also removes the job scheduler, so no future fires.)
      if (
        !campaign ||
        campaign.status === "CANCELLED" ||
        campaign.status === "PAUSED"
      ) {
        return;
      }

      // A/B decision phase: pick the winning subject and release the remainder.
      if (job.data.phase === "decide") {
        await decideAbTest(campaign, job.data.occurrenceKey);
        return;
      }

      // Defensive guard for one-shot scheduled jobs that somehow run early.
      if (
        campaign.status === "SCHEDULED" &&
        !campaign.cronExpression &&
        campaign.scheduledAt &&
        campaign.scheduledAt.getTime() > Date.now()
      ) {
        await campaignProcessingQueue.add(
          "process-campaign",
          { campaignId: campaign.id, occurrenceKey: job.data.occurrenceKey },
          {
            delay: campaign.scheduledAt.getTime() - Date.now(),
            jobId: `campaign-${campaign.id}-${campaign.scheduledAt.toISOString()}`
          }
        );
        return;
      }

      if (campaign.status === "SCHEDULED") {
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: "SENDING" }
        });
      } else if (campaign.status !== "SENDING") {
        return;
      }

      // Each execution is scoped to a CampaignRun keyed by occurrenceKey, so a
      // recurring campaign creates fresh email jobs every fire while retries and
      // crash recovery stay idempotent.
      const occurrenceKey =
        job.data.occurrenceKey ?? job.id ?? String(job.timestamp);

      const run = await prisma.campaignRun.upsert({
        where: {
          campaignId_occurrenceKey: { campaignId: campaign.id, occurrenceKey }
        },
        create: { campaignId: campaign.id, occurrenceKey },
        update: {}
      });

      const abEnabled =
        campaign.abTestEnabled &&
        campaign.variants.length >= 2 &&
        campaign.abTestPercent != null &&
        campaign.abWinnerMetric != null &&
        campaign.abTestWindowMin != null;

      const existingJobs = await prisma.emailJob.findMany({
        where: { campaignRunId: run.id },
        select: { id: true, status: true }
      });

      // Retry/recovery of a fire that already created its jobs: re-enqueue only
      // the queued ones (A/B held remainder stays PENDING until the decision).
      if (existingJobs.length > 0) {
        await enqueueEmailJobs(
          existingJobs
            .filter((emailJob) => emailJob.status === "QUEUED")
            .map((emailJob) => emailJob.id)
        );
        // Re-ensure the decision job exists if a crash happened mid-fan-out.
        if (abEnabled && campaign.abTestStatus === "TESTING") {
          await scheduleAbDecision(campaign, occurrenceKey);
        }
        return;
      }

      if (!campaign.template || (!campaign.contactList && !campaign.segment)) {
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: "CANCELLED" }
        });
        throw new Error(
          "Campaign requires a template and a contact list or segment"
        );
      }

      const template = campaign.template;

      const smtpConnection = await prisma.sMTPConnection.findFirst({
        where: { organizationId: campaign.organizationId, isDefault: true },
        select: { id: true }
      });

      if (!smtpConnection) {
        throw new Error("Default SMTP connection not found");
      }

      // A segment re-resolves to its current ACTIVE matches at send time; a
      // contact list uses its (already ACTIVE-filtered) membership snapshot.
      const activeContacts = campaign.segment
        ? await prisma.contact.findMany({
            where: {
              organizationId: campaign.organizationId,
              status: "ACTIVE",
              ...(compileSegmentRules(
                campaign.segment.rules as SegmentRule
              ) as Prisma.ContactWhereInput)
            },
            orderBy: { createdAt: "asc" }
          })
        : campaign.contactList!.members.map((member) => member.contact);

      // Exclude addresses on the org's suppression list. The ACTIVE-status
      // filter already drops bounced/unsubscribed contacts, but a manual
      // suppression can target an address whose contact is still ACTIVE.
      const suppressed =
        activeContacts.length > 0
          ? await prisma.suppression.findMany({
              where: {
                organizationId: campaign.organizationId,
                email: { in: activeContacts.map((contact) => contact.email) }
              },
              select: { email: true }
            })
          : [];
      const suppressedEmails = new Set(suppressed.map((row) => row.email));
      const contacts = activeContacts.filter(
        (contact) => !suppressedEmails.has(contact.email)
      );

      if (contacts.length === 0) {
        // No deliverable recipients this run: settle it so a recurring campaign
        // returns to SCHEDULED (and a one-shot is marked SENT).
        await settleRunIfComplete(run.id);
        return;
      }

      const baseJob = (
        contact: (typeof contacts)[number],
        subjectSource: string,
        variantId: string | null,
        status: "QUEUED" | "PENDING"
      ) => {
        const variables = contactVariables(contact);
        return {
          organizationId: campaign.organizationId,
          smtpConnectionId: smtpConnection.id,
          templateId: campaign.templateId,
          campaignId: campaign.id,
          campaignRunId: run.id,
          origin: "CAMPAIGN" as const,
          toEmail: contact.email,
          subject: renderVariables(subjectSource, variables) ?? subjectSource,
          html: renderVariables(template.html, variables),
          text: renderVariables(template.text, variables),
          variables,
          variantId,
          status
        };
      };

      // A/B fan-out: send the test fraction across variants now, hold the rest.
      if (abEnabled) {
        const variants = campaign.variants;
        const testCount = Math.min(
          contacts.length,
          Math.max(
            Math.floor((contacts.length * campaign.abTestPercent!) / 100),
            variants.length
          )
        );
        const testContacts = contacts.slice(0, testCount);
        const remainder = contacts.slice(testCount);

        await prisma.$transaction(async (tx) => {
          await tx.emailJob.createMany({
            data: [
              ...testContacts.map((contact, index) => {
                const variant = variants[index % variants.length];
                return baseJob(contact, variant.subject, variant.id, "QUEUED");
              }),
              // Held until the decision job assigns the winning subject.
              ...remainder.map((contact) =>
                baseJob(contact, template.subject, null, "PENDING")
              )
            ]
          });
          await tx.campaign.update({
            where: { id: campaign.id },
            data: { abTestStatus: "TESTING" }
          });
        });

        const testJobs = await prisma.emailJob.findMany({
          where: { campaignRunId: run.id, status: "QUEUED" },
          select: { id: true }
        });
        await enqueueEmailJobs(testJobs.map((emailJob) => emailJob.id));
        await scheduleAbDecision(campaign, occurrenceKey);
        return;
      }

      const emailJobs = await prisma.$transaction(async (tx) => {
        await tx.emailJob.createMany({
          data: contacts.map((contact) =>
            baseJob(contact, template.subject, null, "QUEUED")
          )
        });

        return tx.emailJob.findMany({
          where: { campaignRunId: run.id },
          select: { id: true }
        });
      });

      await enqueueEmailJobs(emailJobs.map((emailJob) => emailJob.id));
    },
    {
      connection: redisConnection,
      concurrency: 2
    }
  );
}

/**
 * Choose the winning subject variant by the configured metric (open or click)
 * over the test fraction, then release the held remainder with the winner's
 * subject. Idempotent: only runs while the campaign is still TESTING.
 */
async function decideAbTest(
  campaign: {
    id: string;
    abTestEnabled: boolean;
    abTestStatus: string | null;
    abWinnerMetric: string | null;
    variants: Array<{ id: string; label: string; subject: string }>;
  },
  occurrenceKey: string | undefined
) {
  if (
    !campaign.abTestEnabled ||
    campaign.variants.length < 2 ||
    campaign.abTestStatus !== "TESTING" ||
    !occurrenceKey
  ) {
    return;
  }

  const run = await prisma.campaignRun.findUnique({
    where: {
      campaignId_occurrenceKey: { campaignId: campaign.id, occurrenceKey }
    },
    select: { id: true }
  });
  if (!run) {
    return;
  }

  const metricType = campaign.abWinnerMetric === "CLICK" ? "CLICKED" : "OPENED";

  const scored = await Promise.all(
    campaign.variants.map(async (variant) => ({
      variant,
      count: await prisma.emailEvent.count({
        where: {
          type: metricType,
          emailJob: { campaignRunId: run.id, variantId: variant.id }
        }
      })
    }))
  );

  // Highest metric wins; ties break to the lowest label for determinism.
  scored.sort(
    (a, b) =>
      b.count - a.count || a.variant.label.localeCompare(b.variant.label)
  );
  const winner = scored[0].variant;

  await prisma.$transaction([
    prisma.campaignVariant.update({
      where: { id: winner.id },
      data: { isWinner: true }
    }),
    prisma.campaign.update({
      where: { id: campaign.id },
      data: { abTestStatus: "DECIDED" }
    })
  ]);

  const held = await prisma.emailJob.findMany({
    where: { campaignRunId: run.id, status: "PENDING" },
    select: { id: true, variables: true }
  });

  for (const emailJob of held) {
    const variables = (emailJob.variables ?? {}) as Record<string, unknown>;
    await prisma.emailJob.update({
      where: { id: emailJob.id },
      data: {
        status: "QUEUED",
        variantId: winner.id,
        subject: renderVariables(winner.subject, variables) ?? winner.subject
      }
    });
  }

  await enqueueEmailJobs(held.map((emailJob) => emailJob.id));

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { abTestStatus: "SENT" }
  });

  // If there was no remainder, the test jobs may already be complete.
  await settleRunIfComplete(run.id);
}
