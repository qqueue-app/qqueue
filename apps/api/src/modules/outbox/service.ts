import { aggregateDeliveryStatus, type OutboxEmail } from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import {
  emailJobScope,
  resolveMailboxAccess,
} from "../../lib/mailbox-access.js";
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
  async list(organizationId: string, userId: string): Promise<OutboxEmail[]> {
    const access = await resolveMailboxAccess(userId, organizationId);
    const jobs = await prisma.emailJob.findMany({
      where: {
        organizationId,
        NOT: { origin: "SYSTEM" },
        groupPrimary: true,
        AND: [
          {
            OR: [
              { groupStatus: null, status: { in: [...PENDING_STATUSES] } },
              { groupStatus: { in: [...PENDING_STATUSES] } },
            ],
          },
          emailJobScope(access),
        ],
      },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
      take: OUTBOX_LIMIT,
      select: {
        id: true,
        subject: true,
        toEmail: true,
        cc: true,
        bcc: true,
        status: true,
        groupStatus: true,
        visibleTo: true,
        visibleCc: true,
        visibleBcc: true,
        origin: true,
        scheduledAt: true,
        createdAt: true,
        campaign: { select: { name: true } },
        smtpConnection: {
          select: { name: true, fromEmail: true, fromName: true },
        },
      },
    });

    return jobs.map((job) => ({
      id: job.id,
      subject: job.subject,
      // toEmail is the comma-joined To set for multi-recipient manual sends.
      to: (job.visibleTo?.length ? job.visibleTo.join(",") : job.toEmail)
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean),
      ccCount: job.visibleCc?.length ?? job.cc.length,
      bccCount: job.visibleBcc?.length || job.bcc.length,
      status: job.groupStatus ?? job.status,
      origin: job.origin,
      scheduledAt: job.scheduledAt ? job.scheduledAt.toISOString() : null,
      createdAt: job.createdAt.toISOString(),
      campaignName: job.campaign?.name ?? null,
      sendingAccount: job.smtpConnection
        ? {
            name: job.smtpConnection.name,
            fromEmail: job.smtpConnection.fromEmail,
            fromName: job.smtpConnection.fromName,
          }
        : null,
    }));
  },

  /**
   * Cancel a queued or scheduled email. Postgres is the source of truth, so the
   * status flips first and the delayed BullMQ job is removed afterwards on a
   * best-effort basis: if the worker has already picked the job up, removal
   * fails harmlessly because the send worker re-reads the row and skips
   * CANCELLED jobs before touching SMTP.
   *
   * Cancelling is scoped exactly like listing, so a member can only pull back
   * mail they can see. Before per-mailbox access existed, any member could
   * cancel any queued job in the organization.
   */
  async cancel(id: string, organizationId: string, userId: string) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const job = await prisma.emailJob.findFirst({
      where: {
        id,
        organizationId,
        NOT: { origin: "SYSTEM" },
        ...emailJobScope(access),
      },
      select: { id: true, status: true, groupStatus: true, sendGroupId: true },
    });

    if (!job) {
      throw new HttpError(404, "Email not found", "not_found");
    }

    if (!CANCELLABLE_STATUSES.has(job.groupStatus ?? job.status)) {
      throw new HttpError(
        409,
        job.status === "PROCESSING"
          ? "This email is already being sent"
          : "This email has already been sent",
        "conflict"
      );
    }

    const result = await prisma.emailJob.updateMany({
      where: {
        organizationId,
        ...(job.sendGroupId
          ? { sendGroupId: job.sendGroupId }
          : { id: job.id }),
        status: { in: ["PENDING", "QUEUED"] },
        ...emailJobScope(access),
      },
      data: { status: "CANCELLED" },
    });
    if (!result.count)
      throw new HttpError(409, "This email is already being sent", "conflict");
    // Delivery claims use the same conditional write, so cancellation cannot
    // overwrite PROCESSING after a worker has taken ownership.
    let status = "CANCELLED";
    if (job.sendGroupId) {
      status = await prisma.$transaction(async (db) => {
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId + ":group:" + job.sendGroupId}, 0))`;
        const deliveries = await db.emailJob.findMany({
          where: { organizationId, sendGroupId: job.sendGroupId },
          select: { status: true },
        });
        const groupStatus =
          aggregateDeliveryStatus(
            deliveries.map((delivery) => delivery.status)
          ) ?? "CANCELLED";
        await db.emailJob.updateMany({
          where: {
            organizationId,
            sendGroupId: job.sendGroupId,
            groupPrimary: true,
          },
          data: { groupStatus },
        });
        return groupStatus;
      });
    }
    await emailSendingQueue.remove(`email-${job.id}`).catch(() => undefined);
    return { id: job.id, status };
  },
};
