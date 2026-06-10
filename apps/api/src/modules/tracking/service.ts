import { z } from "zod";
import { emailAddressSchema } from "@qqueue/shared";
import { prisma } from "../../lib/prisma.js";
import { webhookEndpointService } from "../webhooks/service.js";

// A 1x1 fully transparent GIF, served as the open-tracking pixel.
export const TRACKING_PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export const webhookEventSchema = z.object({
  type: z.enum(["DELIVERED", "BOUNCED", "COMPLAINED"]),
  // Provider message id (preferred) or the QQueue email job id — either is
  // enough to find the originating send.
  messageId: z.string().min(1).optional(),
  emailJobId: z.string().min(1).optional(),
  email: emailAddressSchema.optional(),
  reason: z.string().optional()
});

export type WebhookEventInput = z.infer<typeof webhookEventSchema>;

async function findJob(emailJobId: string) {
  return prisma.emailJob.findUnique({
    where: { id: emailJobId },
    select: { id: true, organizationId: true, toEmail: true }
  });
}

export const trackingService = {
  /** Record an open (and a one-time DELIVERED, since an open implies delivery). */
  async recordOpen(emailJobId: string) {
    const job = await findJob(emailJobId);
    if (!job) {
      return;
    }

    const delivered = await prisma.emailEvent.findFirst({
      where: { emailJobId, type: "DELIVERED" },
      select: { id: true }
    });

    await prisma.emailEvent.createMany({
      data: [
        ...(delivered
          ? []
          : [
              {
                organizationId: job.organizationId,
                emailJobId,
                type: "DELIVERED" as const
              }
            ]),
        {
          organizationId: job.organizationId,
          emailJobId,
          type: "OPENED" as const
        }
      ]
    });

    if (!delivered) {
      await webhookEndpointService.enqueueLatestForEmailEvent({
        organizationId: job.organizationId,
        emailJobId,
        type: "DELIVERED"
      });
    }
    await webhookEndpointService.enqueueLatestForEmailEvent({
      organizationId: job.organizationId,
      emailJobId,
      type: "OPENED"
    });
  },

  /** Record a link click. `url` is the verified original destination. */
  async recordClick(emailJobId: string, url: string) {
    const job = await findJob(emailJobId);
    if (!job) {
      return;
    }

    const event = await prisma.emailEvent.create({
      data: {
        organizationId: job.organizationId,
        emailJobId,
        type: "CLICKED",
        metadata: { url }
      }
    });

    await webhookEndpointService.enqueueForEmailEvent(event.id);
  },

  /**
   * Record a normalized ESP webhook (bounce/complaint/delivered). Correlates by
   * provider messageId, falling back to the email job id. Hard bounces and
   * complaints also mark the matching contact so it is skipped on future sends.
   * Returns false when no matching email job is found.
   */
  async recordWebhookEvent(input: WebhookEventInput) {
    const job = input.emailJobId
      ? await findJob(input.emailJobId)
      : input.messageId
        ? await prisma.emailJob.findFirst({
            where: { messageId: input.messageId },
            select: { id: true, organizationId: true, toEmail: true },
            orderBy: { createdAt: "desc" }
          })
        : null;

    if (!job) {
      return false;
    }

    const event = await prisma.emailEvent.create({
      data: {
        organizationId: job.organizationId,
        emailJobId: job.id,
        type: input.type,
        metadata: {
          source: "webhook",
          ...(input.reason ? { reason: input.reason } : {}),
          ...(input.messageId ? { messageId: input.messageId } : {})
        }
      }
    });

    await webhookEndpointService.enqueueForEmailEvent(event.id);

    if (input.type === "BOUNCED" || input.type === "COMPLAINED") {
      await prisma.contact.updateMany({
        where: {
          organizationId: job.organizationId,
          email: input.email ?? job.toEmail
        },
        data: { status: "BOUNCED" }
      });
    }

    return true;
  }
};
