import type { OutboxEmail } from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { emailSendingQueue } from "../../queues/email-sending.queue.js";

// The outbox is a live view, not an archive: only what is still on its way.
// PROCESSING is included because a job can sit there while the worker waits on
// a domain throttle, but it can no longer be cancelled.
const PENDING_STATUSES = ["PENDING", "QUEUED", "PROCESSING"] as const;
const CANCELLABLE_STATUSES = new Set(["PENDING", "QUEUED"]);
const OUTBOX_LIMIT = 100;

export const outboxService = {
  /**
   * Everything still waiting to go out for an organization, soonest first.
   * Covers every origin (campaign fan-out, transactional API, manual sends)
   * because they all land in the same EmailJob table.
   */
  async list(organizationId: string): Promise<OutboxEmail[]> {
    const jobs = await prisma.emailJob.findMany({
      where: { organizationId, status: { in: [...PENDING_STATUSES] } },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
      take: OUTBOX_LIMIT,
      select: {
        id: true,
        subject: true,
        toEmail: true,
        cc: true,
        bcc: true,
        status: true,
        origin: true,
        scheduledAt: true,
        createdAt: true,
        campaign: { select: { name: true } },
        smtpConnection: {
          select: { name: true, fromEmail: true, fromName: true }
        }
      }
    });

    return jobs.map((job) => ({
      id: job.id,
      subject: job.subject,
      // toEmail is the comma-joined To set for multi-recipient manual sends.
      to: job.toEmail
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean),
      ccCount: job.cc.length,
      bccCount: job.bcc.length,
      status: job.status,
      origin: job.origin,
      scheduledAt: job.scheduledAt ? job.scheduledAt.toISOString() : null,
      createdAt: job.createdAt.toISOString(),
      campaignName: job.campaign?.name ?? null,
      sendingAccount: job.smtpConnection
        ? {
            name: job.smtpConnection.name,
            fromEmail: job.smtpConnection.fromEmail,
            fromName: job.smtpConnection.fromName
          }
        : null
    }));
  },

  /**
   * Cancel a queued or scheduled email. Postgres is the source of truth, so the
   * status flips first and the delayed BullMQ job is removed afterwards on a
   * best-effort basis: if the worker has already picked the job up, removal
   * fails harmlessly because the send worker re-reads the row and skips
   * CANCELLED jobs before touching SMTP.
   */
  async cancel(id: string, organizationId: string) {
    const job = await prisma.emailJob.findFirst({
      where: { id, organizationId },
      select: { id: true, status: true }
    });

    if (!job) {
      throw new HttpError(404, "Email not found", "not_found");
    }

    if (!CANCELLABLE_STATUSES.has(job.status)) {
      throw new HttpError(
        409,
        job.status === "PROCESSING"
          ? "This email is already being sent"
          : "This email has already been sent",
        "conflict"
      );
    }

    const cancelled = await prisma.emailJob.update({
      where: { id: job.id },
      data: { status: "CANCELLED" }
    });

    // Matches the jobId both enqueue sites use (transactional-email service and
    // the campaign fan-out worker).
    await emailSendingQueue.remove(`email-${job.id}`).catch(() => undefined);

    return { id: cancelled.id, status: cancelled.status };
  }
};
