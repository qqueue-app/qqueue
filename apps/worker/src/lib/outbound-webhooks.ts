import { prisma } from "./prisma.js";
import { webhookDeliveryQueue } from "../queues/webhook-delivery.queue.js";

type EmailEventType =
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "OPENED"
  | "CLICKED"
  | "BOUNCED"
  | "COMPLAINED"
  | "FAILED";

function toOutboundWebhookEventName(type: EmailEventType) {
  return `email.${type.toLowerCase()}` as const;
}

export async function enqueueLatestWebhookDeliveries(input: {
  organizationId: string;
  emailJobId: string;
  type: EmailEventType;
}) {
  const event = await prisma.emailEvent.findFirst({
    where: {
      organizationId: input.organizationId,
      emailJobId: input.emailJobId,
      type: input.type
    },
    include: {
      emailJob: {
        select: {
          id: true,
          toEmail: true,
          subject: true,
          status: true,
          messageId: true,
          campaignId: true,
          templateId: true
        }
      }
    },
    orderBy: { occurredAt: "desc" }
  });

  if (!event) {
    return;
  }

  const eventName = toOutboundWebhookEventName(event.type as EmailEventType);
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      organizationId: event.organizationId,
      enabled: true,
      deletedAt: null,
      events: { has: eventName }
    },
    select: { id: true }
  });

  for (const endpoint of endpoints) {
    const delivery = await prisma.webhookDelivery.create({
      data: {
        organizationId: event.organizationId,
        endpointId: endpoint.id,
        emailEventId: event.id,
        eventName,
        payload: {
          id: event.id,
          type: eventName,
          createdAt: event.occurredAt.toISOString(),
          data: {
            emailJob: {
              id: event.emailJob.id,
              to: event.emailJob.toEmail,
              subject: event.emailJob.subject,
              status: event.emailJob.status,
              messageId: event.emailJob.messageId,
              campaignId: event.emailJob.campaignId,
              templateId: event.emailJob.templateId
            },
            metadata: event.metadata
          }
        }
      },
      select: { id: true }
    });

    await webhookDeliveryQueue.add(
      "deliver-webhook",
      { deliveryId: delivery.id },
      {
        jobId: `webhook-${delivery.id}`,
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 }
      }
    );
  }
}
