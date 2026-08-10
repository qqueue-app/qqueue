import {
  emailJobScope,
  resolveMailboxAccess
} from "../../lib/mailbox-access.js";
import { prisma } from "../../lib/prisma.js";

const recentEmailJobSelect = {
  id: true,
  toEmail: true,
  subject: true,
  status: true,
  createdAt: true,
  sentAt: true,
  smtpConnection: {
    select: {
      name: true
    }
  }
};

const recentEventSelect = {
  id: true,
  type: true,
  occurredAt: true,
  emailJob: {
    select: {
      toEmail: true,
      subject: true
    }
  }
};

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

export const dashboardService = {
  /**
   * The two "recent" lists carry subjects and recipients — the same content the
   * sent archive shows — so they answer to the same per-mailbox rule. Without
   * that, scoping the archive would be cosmetic: the whole organization's mail
   * would still be readable one page over.
   *
   * The counts above them stay organization-wide on purpose. They are
   * aggregates, not mail, and a member watching "12 failed today" learns
   * nothing about who was written to.
   */
  async summary(organizationId: string, userId: string) {
    const today = startOfToday();
    const access = await resolveMailboxAccess(userId, organizationId);
    const visibleJobs = emailJobScope(access);

    const [
      smtpConnections,
      defaultSmtpConnection,
      contacts,
      templates,
      emailsToday,
      failedToday,
      processingEmails,
      recentEmailJobs,
      recentEvents
    ] = await Promise.all([
      prisma.sMTPConnection.count({ where: { organizationId } }),
      prisma.sMTPConnection.findFirst({
        where: { organizationId, isDefault: true },
        select: { id: true, name: true, host: true, fromEmail: true }
      }),
      prisma.contact.count({ where: { organizationId } }),
      prisma.template.count({ where: { organizationId } }),
      prisma.emailJob.count({
        where: {
          organizationId,
          createdAt: { gte: today }
        }
      }),
      prisma.emailJob.count({
        where: {
          organizationId,
          status: "FAILED",
          createdAt: { gte: today }
        }
      }),
      prisma.emailJob.count({
        where: {
          organizationId,
          status: "PROCESSING"
        }
      }),
      prisma.emailJob.findMany({
        where: { organizationId, ...visibleJobs },
        select: recentEmailJobSelect,
        orderBy: { createdAt: "desc" },
        take: 8
      }),
      prisma.emailEvent.findMany({
        // Scoped through the job the event belongs to: an event names the
        // recipient and subject of the mail it happened to.
        where: { organizationId, emailJob: visibleJobs },
        select: recentEventSelect,
        orderBy: { occurredAt: "desc" },
        take: 8
      })
    ]);

    return {
      counts: {
        smtpConnections,
        contacts,
        templates,
        emailsToday,
        failedToday,
        processingEmails
      },
      setup: {
        hasSmtpConnection: smtpConnections > 0,
        hasDefaultSmtp: Boolean(defaultSmtpConnection),
        hasContacts: contacts > 0,
        hasTemplates: templates > 0
      },
      defaultSmtpConnection,
      recentEmailJobs: recentEmailJobs.map(
        (job: {
          id: string;
          toEmail: string;
          subject: string;
          status: string;
          createdAt: Date;
          sentAt: Date | null;
          smtpConnection: { name: string } | null;
        }) => ({
        id: job.id,
        toEmail: job.toEmail,
        subject: job.subject,
        status: job.status,
        smtpConnectionName: job.smtpConnection?.name ?? null,
        createdAt: job.createdAt.toISOString(),
        sentAt: job.sentAt?.toISOString() ?? null
      })
      ),
      recentEvents: recentEvents.map(
        (event: {
          id: string;
          type: string;
          occurredAt: Date;
          emailJob: { toEmail: string; subject: string };
        }) => ({
        id: event.id,
        type: event.type,
        occurredAt: event.occurredAt.toISOString(),
        emailJob: {
          toEmail: event.emailJob.toEmail,
          subject: event.emailJob.subject
        }
      })
      )
    };
  }
};
