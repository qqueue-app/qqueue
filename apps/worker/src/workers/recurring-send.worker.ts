import { Worker } from "bullmq";
import { nextCronRun } from "@qqueue/shared";
import { renderHtmlAsEmailSafe } from "@qqueue/email-engine";
import { redisConnection } from "../config/redis.js";
import { emailSendingQueue } from "../queues/email-sending.queue.js";
import type { RecurringSendJob } from "../queues/recurring-send.queue.js";
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

function normalize(email: string) {
  return email.trim().toLowerCase();
}

function dedupe(emails: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of emails) {
    const email = normalize(raw);
    if (email && !seen.has(email)) {
      seen.add(email);
      result.push(email);
    }
  }
  return result;
}

/**
 * Expand ad-hoc addresses, contacts and whole lists into a deduplicated
 * recipient set. Mirrors manualEmailService.resolveRecipients in the API (which
 * the worker cannot import across app boundaries): a recipient is counted once,
 * CC drops anything already in To, and BCC drops anything in To or CC.
 *
 * Membership is resolved at each firing rather than snapshotted at creation, so
 * contacts added to a list later are picked up automatically.
 */
async function resolveRecipients(input: {
  organizationId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  contactIds: string[];
  listIds: string[];
}) {
  const contactIds = new Set(input.contactIds);

  if (input.listIds.length > 0) {
    const members = await prisma.contactListMember.findMany({
      where: {
        contactListId: { in: input.listIds },
        contactList: { organizationId: input.organizationId }
      },
      select: { contactId: true }
    });
    for (const member of members) {
      contactIds.add(member.contactId);
    }
  }

  let contactEmails: string[] = [];
  if (contactIds.size > 0) {
    const contacts = await prisma.contact.findMany({
      where: {
        id: { in: [...contactIds] },
        organizationId: input.organizationId
      },
      select: { email: true }
    });
    contactEmails = contacts.map((contact) => contact.email);
  }

  const to = dedupe([...input.to, ...contactEmails]);
  const toSet = new Set(to);
  const cc = dedupe(input.cc).filter((email) => !toSet.has(email));
  const ccSet = new Set(cc);
  const bcc = dedupe(input.bcc).filter(
    (email) => !toSet.has(email) && !ccSet.has(email)
  );

  return { to, cc, bcc };
}

export async function processRecurringSend(job: {
  id?: string;
  data: RecurringSendJob;
  timestamp: number;
}) {
  const send = await prisma.recurringSend.findUnique({
    where: { id: job.data.recurringSendId }
  });

  // Deleted, or paused after this job was already queued.
  if (!send || send.status !== "ACTIVE") {
    return;
  }

  // A scheduler fire carries no explicit key, so fall back to the BullMQ job id
  // (which embeds the fire timestamp). The unique index on
  // (recurringSendId, occurrenceKey) is what makes a redelivered job a no-op.
  const occurrenceKey =
    job.data.occurrenceKey ?? job.id ?? String(job.timestamp);

  const existingRun = await prisma.recurringSendRun.findUnique({
    where: {
      recurringSendId_occurrenceKey: {
        recurringSendId: send.id,
        occurrenceKey
      }
    },
    select: { id: true }
  });
  if (existingRun) {
    return;
  }

  const recipients = await resolveRecipients({
    organizationId: send.organizationId,
    to: send.to,
    cc: send.cc,
    bcc: send.bcc,
    contactIds: send.contactIds,
    listIds: send.listIds
  });

  // Record the occurrence even when it produces nothing to send, so an empty
  // list doesn't make the same firing retry forever.
  const run = await prisma.recurringSendRun.create({
    data: { recurringSendId: send.id, occurrenceKey }
  });

  if (recipients.to.length > 0) {
    const variables = (send.variables ?? {}) as Record<string, unknown>;
    const subject = renderVariables(send.subject, variables) ?? send.subject;
    const text = renderVariables(send.text, variables);
    const rawHtml = renderVariables(send.html, variables);

    // Same MJML email-safe wrap the one-off manual send applies.
    let html: string | undefined;
    if (rawHtml) {
      const rendered = await renderHtmlAsEmailSafe(rawHtml);
      if (rendered.usedFallback) {
        console.error(
          `[recurring-send] MJML compilation failed for ${send.id}; sending unwrapped body. ${rendered.errors.join("; ")}`
        );
      }
      html = rendered.html;
    }

    // An ordinary EmailJob: the email-sending worker performs the actual
    // delivery, including the suppression re-check, so this stays a new entry
    // point into the one pipeline rather than a parallel send path.
    const emailJob = await prisma.emailJob.create({
      data: {
        organizationId: send.organizationId,
        smtpConnectionId: send.smtpConnectionId,
        templateId: send.templateId,
        toEmail: recipients.to.join(", "),
        cc: recipients.cc,
        bcc: recipients.bcc,
        replyTo: send.replyTo,
        subject,
        html,
        text,
        origin: "MANUAL",
        createdByUserId: send.createdByUserId,
        status: "QUEUED",
        events: {
          create: { organizationId: send.organizationId, type: "QUEUED" }
        }
      }
    });

    await prisma.recurringSendRun.update({
      where: { id: run.id },
      data: { emailJobId: emailJob.id }
    });

    await emailSendingQueue.add(
      "send-email",
      { emailJobId: emailJob.id },
      {
        jobId: `email-${emailJob.id}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 }
      }
    );
  }

  await prisma.recurringSend.update({
    where: { id: send.id },
    data: {
      lastRunAt: new Date(),
      nextRunAt: nextCronRun(send.cronExpression, send.timezone)
    }
  });
}

export function startRecurringSendWorker() {
  return new Worker<RecurringSendJob>(
    "recurring-send",
    async (job) => {
      await processRecurringSend({
        id: job.id,
        data: job.data,
        timestamp: job.timestamp
      });
    },
    { connection: redisConnection, concurrency: 2 }
  );
}
