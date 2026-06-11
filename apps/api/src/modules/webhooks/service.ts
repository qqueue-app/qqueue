import { randomBytes } from "node:crypto";
import type {
  EmailEventType,
  WebhookEndpointInput,
  WebhookEndpointUpdateInput
} from "@qqueue/shared";
import { assertOrgAccess, assertOrgRole } from "../../lib/org-access.js";
import { encryptSecret } from "../../lib/crypto.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { webhookDeliveryQueue } from "../../queues/webhook-delivery.queue.js";

const endpointSelect = {
  id: true,
  organizationId: true,
  name: true,
  url: true,
  events: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true
};

const deliverySelect = {
  id: true,
  organizationId: true,
  endpointId: true,
  emailEventId: true,
  eventName: true,
  status: true,
  attempts: true,
  responseStatus: true,
  error: true,
  nextAttemptAt: true,
  deliveredAt: true,
  createdAt: true
};

export function toOutboundWebhookEventName(type: EmailEventType) {
  return `email.${type.toLowerCase()}` as const;
}

function generateSigningSecret() {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

async function findOwnedEndpoint(id: string, userId: string) {
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: {
      id,
      deletedAt: null,
      organization: { members: { some: { userId } } }
    }
  });

  if (!endpoint) {
    throw new HttpError(404, "Webhook endpoint not found");
  }

  return endpoint;
}

export const webhookEndpointService = {
  async list(organizationId: string, userId: string) {
    await assertOrgAccess(userId, organizationId);
    return prisma.webhookEndpoint.findMany({
      where: { organizationId, deletedAt: null },
      select: endpointSelect,
      orderBy: { createdAt: "desc" }
    });
  },

  async create(input: WebhookEndpointInput, userId: string) {
    await assertOrgRole(userId, input.organizationId, ["OWNER", "ADMIN"]);

    const secret = generateSigningSecret();
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        url: input.url,
        events: input.events,
        enabled: input.enabled ?? true,
        secretEncrypted: encryptSecret(secret)
      },
      select: endpointSelect
    });

    return { endpoint, secret };
  },

  async update(id: string, userId: string, input: WebhookEndpointUpdateInput) {
    const existing = await findOwnedEndpoint(id, userId);
    await assertOrgRole(userId, existing.organizationId, ["OWNER", "ADMIN"]);

    return prisma.webhookEndpoint.update({
      where: { id },
      data: {
        name: input.name,
        url: input.url,
        events: input.events,
        enabled: input.enabled
      },
      select: endpointSelect
    });
  },

  async delete(id: string, userId: string) {
    const existing = await findOwnedEndpoint(id, userId);
    await assertOrgRole(userId, existing.organizationId, ["OWNER", "ADMIN"]);

    await prisma.webhookEndpoint.update({
      where: { id },
      data: { enabled: false, deletedAt: new Date() },
      select: { id: true }
    });
  },

  async listDeliveries(endpointId: string, userId: string) {
    await findOwnedEndpoint(endpointId, userId);
    return prisma.webhookDelivery.findMany({
      where: { endpointId },
      select: deliverySelect,
      orderBy: { createdAt: "desc" },
      take: 25
    });
  },

  async retryDelivery(deliveryId: string, userId: string) {
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        endpointId: true,
        status: true
      }
    });

    if (!delivery) {
      throw new HttpError(404, "Webhook delivery not found", "not_found");
    }

    await findOwnedEndpoint(delivery.endpointId, userId);

    if (delivery.status === "DELIVERED") {
      throw new HttpError(
        409,
        "Delivered webhook deliveries cannot be retried",
        "conflict"
      );
    }

    const retried = await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "PENDING",
        responseStatus: null,
        error: null,
        nextAttemptAt: new Date()
      },
      select: deliverySelect
    });

    await webhookDeliveryQueue.add(
      "deliver-webhook",
      { deliveryId: delivery.id },
      {
        jobId: `webhook-retry-${delivery.id}-${Date.now()}`,
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 }
      }
    );

    return retried;
  },

  async enqueueForEmailEvent(emailEventId: string) {
    const event = await prisma.emailEvent.findUnique({
      where: { id: emailEventId },
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
      }
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
  },

  async enqueueLatestForEmailEvent(input: {
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
      select: { id: true },
      orderBy: { occurredAt: "desc" }
    });

    if (event) {
      await this.enqueueForEmailEvent(event.id);
    }
  }
};
