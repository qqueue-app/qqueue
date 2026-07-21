import type { InputJsonValue } from "@prisma/client/runtime/library";
import {
  nextCronRun,
  type RecurringSendCreateInput,
  type RecurringSendUpdateInput
} from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import {
  recurringSendQueue,
  recurringSendSchedulerId
} from "../../queues/recurring-send.queue.js";

/**
 * Arm (or re-arm) the BullMQ repeatable job for a recurring send. Timing is
 * owned by BullMQ's job scheduler exactly as it is for campaign recurrence —
 * `nextRunAt` on the row is display state, not the trigger.
 */
async function armScheduler(input: {
  id: string;
  cronExpression: string;
  timezone: string;
}) {
  await recurringSendQueue.upsertJobScheduler(
    recurringSendSchedulerId(input.id),
    { pattern: input.cronExpression, tz: input.timezone },
    {
      name: "process-recurring-send",
      data: { recurringSendId: input.id },
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 }
      }
    }
  );
}

async function findOwned(id: string, userId: string) {
  const send = await prisma.recurringSend.findFirst({
    where: { id, organization: { members: { some: { userId } } } }
  });
  if (!send) {
    throw new HttpError(404, "Recurring send not found", "not_found");
  }
  return send;
}

export const recurringSendService = {
  async list(organizationId: string) {
    return prisma.recurringSend.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { runs: true } } }
    });
  },

  async get(id: string, userId: string) {
    return findOwned(id, userId);
  },

  /**
   * Create a recurring send and arm its schedule.
   *
   * The sending account is resolved to a concrete connection here rather than
   * at fire time: "the org default" must mean the default as of when the user
   * set this up, not whatever it happens to be months later.
   */
  async create(input: RecurringSendCreateInput, userId: string) {
    const smtpConnection = await prisma.sMTPConnection.findFirst({
      where: {
        organizationId: input.organizationId,
        id: input.smtpConnectionId,
        ...(input.smtpConnectionId ? {} : { isDefault: true })
      },
      select: { id: true }
    });
    if (!smtpConnection) {
      throw new HttpError(
        404,
        "SMTP connection not found",
        "missing_smtp_connection"
      );
    }

    const nextRunAt = nextCronRun(input.cronExpression, input.timezone);
    if (!nextRunAt) {
      throw new HttpError(
        400,
        "Could not determine the next run time for that schedule",
        "validation_error"
      );
    }

    const send = await prisma.recurringSend.create({
      data: {
        organizationId: input.organizationId,
        createdByUserId: userId,
        name: input.name,
        subject: input.subject,
        html: input.html,
        text: input.text,
        to: input.to ?? [],
        cc: input.cc ?? [],
        bcc: input.bcc ?? [],
        contactIds: input.contactIds ?? [],
        listIds: input.listIds ?? [],
        replyTo: input.replyTo,
        smtpConnectionId: smtpConnection.id,
        templateId: input.templateId,
        variables: input.variables as InputJsonValue | undefined,
        cronExpression: input.cronExpression,
        timezone: input.timezone,
        status: "ACTIVE",
        nextRunAt
      }
    });

    await armScheduler({
      id: send.id,
      cronExpression: send.cronExpression,
      timezone: send.timezone
    });

    return send;
  },

  /** Rename or re-schedule. Message content is intentionally immutable here. */
  async update(id: string, userId: string, input: RecurringSendUpdateInput) {
    const existing = await findOwned(id, userId);

    const cronExpression = input.cronExpression ?? existing.cronExpression;
    const timezone = input.timezone ?? existing.timezone;
    const nextRunAt = nextCronRun(cronExpression, timezone);
    if (!nextRunAt) {
      throw new HttpError(
        400,
        "Could not determine the next run time for that schedule",
        "validation_error"
      );
    }

    const send = await prisma.recurringSend.update({
      where: { id },
      data: {
        name: input.name ?? existing.name,
        cronExpression,
        timezone,
        // A paused send keeps its schedule on record but stays disarmed.
        nextRunAt: existing.status === "ACTIVE" ? nextRunAt : null
      }
    });

    if (send.status === "ACTIVE") {
      await armScheduler({ id: send.id, cronExpression, timezone });
    }

    return send;
  },

  async pause(id: string, userId: string) {
    const existing = await findOwned(id, userId);
    if (existing.status === "PAUSED") {
      return existing;
    }

    // Remove the scheduler so nothing fires while paused; the worker also
    // re-checks status, so a job already in flight is a no-op either way.
    await recurringSendQueue.removeJobScheduler(recurringSendSchedulerId(id));

    return prisma.recurringSend.update({
      where: { id },
      data: { status: "PAUSED", nextRunAt: null }
    });
  },

  async resume(id: string, userId: string) {
    const existing = await findOwned(id, userId);
    if (existing.status === "ACTIVE") {
      return existing;
    }

    const nextRunAt = nextCronRun(existing.cronExpression, existing.timezone);
    if (!nextRunAt) {
      throw new HttpError(
        400,
        "Could not determine the next run time for that schedule",
        "validation_error"
      );
    }

    await armScheduler({
      id: existing.id,
      cronExpression: existing.cronExpression,
      timezone: existing.timezone
    });

    return prisma.recurringSend.update({
      where: { id },
      data: { status: "ACTIVE", nextRunAt }
    });
  },

  async delete(id: string, userId: string): Promise<void> {
    await findOwned(id, userId);
    // Drop the scheduler first: a row deleted while still armed would have the
    // worker waking up for something that no longer exists.
    await recurringSendQueue.removeJobScheduler(recurringSendSchedulerId(id));
    await prisma.recurringSend.delete({ where: { id } });
  }
};
