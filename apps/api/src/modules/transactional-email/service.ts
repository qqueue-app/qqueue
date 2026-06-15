import type { InputJsonValue } from "@prisma/client/runtime/library";
import { injectTracking } from "@qqueue/email-engine";
import type {
  EmailOrigin,
  SendEmailInput,
  TransactionalSendResponse
} from "@qqueue/shared";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { emailSendingQueue } from "../../queues/email-sending.queue.js";
import { attachmentService } from "../attachments/service.js";
import { smtpConnectionService } from "../smtp-connections/service.js";
import { webhookEndpointService } from "../webhooks/service.js";

function renderVariables(
  value: string | null | undefined,
  variables: Record<string, unknown> | undefined
) {
  if (!value || !variables) {
    return value ?? undefined;
  }

  return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    const variable = variables[key];
    return variable === undefined || variable === null ? "" : String(variable);
  });
}

function formatFrom(connection: { fromEmail: string; fromName: string | null }) {
  if (!connection.fromName) {
    return connection.fromEmail;
  }

  return `${connection.fromName} <${connection.fromEmail}>`;
}

function parseScheduledAt(value: string | undefined) {
  if (!value) {
    return null;
  }

  const scheduledAt = new Date(value);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new HttpError(
      400,
      "scheduledAt must be a valid ISO date",
      "invalid_schedule"
    );
  }

  if (scheduledAt.getTime() <= Date.now()) {
    throw new HttpError(
      400,
      "scheduledAt must be in the future",
      "invalid_schedule"
    );
  }

  return scheduledAt;
}

/**
 * Internal send options. `origin`/`createdByUserId` are not part of the public
 * API schema: the transactional endpoint leaves them unset (defaults to
 * TRANSACTIONAL), while a future manual-composer route (Phase B) will pass
 * `origin: "MANUAL"` and the authenticated dashboard user.
 */
export type TransactionalSendInput = SendEmailInput & {
  origin?: EmailOrigin;
  createdByUserId?: string | null;
};

export const transactionalEmailService = {
  async send(
    input: TransactionalSendInput
  ): Promise<TransactionalSendResponse> {
    const smtpConnection = await prisma.sMTPConnection.findFirst({
      where: {
        organizationId: input.organizationId,
        id: input.smtpConnectionId,
        ...(input.smtpConnectionId ? {} : { isDefault: true })
      }
    });

    if (!smtpConnection) {
      throw new HttpError(
        404,
        "SMTP connection not found",
        "missing_smtp_connection"
      );
    }

    const template = input.templateId
      ? await prisma.template.findFirst({
          where: {
            id: input.templateId,
            organizationId: input.organizationId
          }
        })
      : null;

    if (input.templateId && !template) {
      throw new HttpError(404, "Template not found", "invalid_template");
    }

    const subject = renderVariables(
      input.subject ?? template?.subject,
      input.variables
    );
    const html = renderVariables(input.html ?? template?.html, input.variables);
    const text = renderVariables(input.text ?? template?.text, input.variables);

    if (!subject || (!html && !text)) {
      throw new HttpError(
        400,
        "Provide a subject and html/text body, or a templateId",
        "validation_error"
      );
    }

    const scheduledAt = parseScheduledAt(input.scheduledAt);

    const origin: EmailOrigin = input.origin ?? "TRANSACTIONAL";

    // Send later: queue the email for a future time instead of sending inline.
    if (scheduledAt) {
      const queuedJob = await prisma.emailJob.create({
        data: {
          organizationId: input.organizationId,
          smtpConnectionId: smtpConnection.id,
          templateId: template?.id,
          toEmail: input.to,
          cc: input.cc ?? [],
          bcc: input.bcc ?? [],
          replyTo: input.replyTo,
          origin,
          createdByUserId: input.createdByUserId,
          subject,
          html,
          text,
          variables: input.variables as InputJsonValue | undefined,
          status: "QUEUED",
          scheduledAt,
          events: {
            create: {
              organizationId: input.organizationId,
              type: "QUEUED"
            }
          }
        }
      });

      await attachmentService.linkToJob(
        input.attachmentIds,
        input.organizationId,
        queuedJob.id
      );

      await emailSendingQueue.add(
        "send-email",
        { emailJobId: queuedJob.id },
        {
          delay: Math.max(0, scheduledAt.getTime() - Date.now()),
          jobId: `email-${queuedJob.id}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 30_000 }
        }
      );

      await webhookEndpointService.enqueueLatestForEmailEvent({
        organizationId: input.organizationId,
        emailJobId: queuedJob.id,
        type: "QUEUED"
      });

      return { id: queuedJob.id, status: queuedJob.status };
    }

    const emailJob = await prisma.emailJob.create({
      data: {
        organizationId: input.organizationId,
        smtpConnectionId: smtpConnection.id,
        templateId: template?.id,
        toEmail: input.to,
        cc: input.cc ?? [],
        bcc: input.bcc ?? [],
        replyTo: input.replyTo,
        origin,
        createdByUserId: input.createdByUserId,
        subject,
        html,
        text,
        variables: input.variables as InputJsonValue | undefined,
        status: "PROCESSING",
        events: {
          create: {
            organizationId: input.organizationId,
            type: "QUEUED"
          }
        }
      }
    });

    await attachmentService.linkToJob(
      input.attachmentIds,
      input.organizationId,
      emailJob.id
    );

    await webhookEndpointService.enqueueLatestForEmailEvent({
      organizationId: input.organizationId,
      emailJobId: emailJob.id,
      type: "QUEUED"
    });

    try {
      const provider =
        smtpConnectionService.getProviderForConnection(smtpConnection);
      const attachments = await attachmentService.loadForJob(emailJob.id);
      const result = await provider.send({
        from: formatFrom(smtpConnection),
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        replyTo: input.replyTo,
        subject,
        html: injectTracking(html, {
          emailJobId: emailJob.id,
          baseUrl: env.APP_URL,
          secret: env.TRACKING_SECRET
        }),
        text,
        attachments
      });

      const sentJob = await prisma.emailJob.update({
        where: { id: emailJob.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          messageId: result.messageId,
          events: {
            create: {
              organizationId: input.organizationId,
              type: "SENT",
              metadata: {
                provider: result.provider,
                messageId: result.messageId,
                accepted: result.accepted,
                rejected: result.rejected
              }
            }
          }
        }
      });

      await webhookEndpointService.enqueueLatestForEmailEvent({
        organizationId: input.organizationId,
        emailJobId: emailJob.id,
        type: "SENT"
      });

      return { id: sentJob.id, status: sentJob.status };
    } catch (error) {
      await prisma.emailJob.update({
        where: { id: emailJob.id },
        data: {
          status: "FAILED",
          events: {
            create: {
              organizationId: input.organizationId,
              type: "FAILED",
              metadata: {
                message:
                  error instanceof Error ? error.message : "Unknown send error"
              }
            }
          }
        }
      });

      await webhookEndpointService.enqueueLatestForEmailEvent({
        organizationId: input.organizationId,
        emailJobId: emailJob.id,
        type: "FAILED"
      });

      const message =
        error instanceof Error ? error.message : "Unknown send error";
      throw new HttpError(
        502,
        env.NODE_ENV === "production"
          ? "SMTP send failed"
          : `SMTP send failed: ${message}`,
        "smtp_failure"
      );
    }
  }
};
