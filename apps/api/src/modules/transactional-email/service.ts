import type { InputJsonValue } from "@prisma/client/runtime/library";
import type { SendEmailInput } from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { emailSendingQueue } from "../../queues/email-sending.queue.js";
import { smtpConnectionService } from "../smtp-connections/service.js";

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

export const transactionalEmailService = {
  async send(input: SendEmailInput) {
    const smtpConnection = await prisma.sMTPConnection.findFirst({
      where: {
        organizationId: input.organizationId,
        id: input.smtpConnectionId,
        ...(input.smtpConnectionId ? {} : { isDefault: true })
      }
    });

    if (!smtpConnection) {
      throw new HttpError(404, "SMTP connection not found");
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
      throw new HttpError(404, "Template not found");
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
        "Provide a subject and html/text body, or a templateId"
      );
    }

    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;

    // Send later: queue the email for a future time instead of sending inline.
    if (scheduledAt && scheduledAt.getTime() > Date.now()) {
      const queuedJob = await prisma.emailJob.create({
        data: {
          organizationId: input.organizationId,
          smtpConnectionId: smtpConnection.id,
          templateId: template?.id,
          toEmail: input.to,
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

      return { emailJob: queuedJob, providerResult: null };
    }

    const emailJob = await prisma.emailJob.create({
      data: {
        organizationId: input.organizationId,
        smtpConnectionId: smtpConnection.id,
        templateId: template?.id,
        toEmail: input.to,
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

    try {
      const provider =
        smtpConnectionService.getProviderForConnection(smtpConnection);
      const result = await provider.send({
        from: formatFrom(smtpConnection),
        to: input.to,
        subject,
        html,
        text
      });

      const sentJob = await prisma.emailJob.update({
        where: { id: emailJob.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
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

      return {
        emailJob: sentJob,
        providerResult: result
      };
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

      throw new HttpError(502, "SMTP send failed");
    }
  }
};
