import type { InputJsonValue } from "@prisma/client/runtime/library";
import type {
  EmailOrigin,
  SendEmailInput,
  TransactionalSendResponse
} from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { isPrismaKnownRequestError } from "../../lib/prisma-error.js";
import { prisma } from "../../lib/prisma.js";
import { assertMayUseConnection } from "../../lib/send-as.js";
import { emailSendingQueue } from "../../queues/email-sending.queue.js";
import { attachmentService } from "../attachments/service.js";
import { suppressionService } from "../suppressions/service.js";
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

type EmailJobRow = Awaited<ReturnType<typeof prisma.emailJob.create>>;

/**
 * Create an EmailJob, transparently handling idempotency-key replays. If a
 * concurrent request already created a job for the same
 * (organizationId, idempotencyKey), the unique constraint trips (P2002); we
 * recover by returning the existing job flagged as a replay so the caller skips
 * re-enqueuing or re-sending.
 */
async function createEmailJob(
  data: Parameters<typeof prisma.emailJob.create>[0]["data"],
  organizationId: string,
  idempotencyKey: string | null
): Promise<{ job: EmailJobRow; replayed: boolean }> {
  try {
    return { job: await prisma.emailJob.create({ data }), replayed: false };
  } catch (error) {
    if (idempotencyKey && isPrismaKnownRequestError(error, "P2002")) {
      const existing = await prisma.emailJob.findUnique({
        where: {
          organizationId_idempotencyKey: { organizationId, idempotencyKey }
        }
      });
      if (existing) {
        return { job: existing, replayed: true };
      }
    }
    throw error;
  }
}

/**
 * Internal send options. `origin`/`createdByUserId` are not part of the public
 * API schema: the transactional endpoint leaves them unset (defaults to
 * TRANSACTIONAL); the Email Studio composer passes `origin: "MANUAL"` and the
 * authenticated dashboard user; instance mail (password resets, invitations)
 * passes `origin: "SYSTEM"`.
 */
export type TransactionalSendInput = SendEmailInput & {
  origin?: EmailOrigin;
  createdByUserId?: string | null;
  // Client-supplied retry key (from the `Idempotency-Key` header). When set, a
  // repeat send with the same key for the same org returns the original job.
  idempotencyKey?: string | null;
  // Internal: groups the per-recipient jobs of one multi-recipient manual send
  // so delivery status can be aggregated. Set by manualEmailService.send.
  sendGroupId?: string | null;
  // Internal: how attachmentIds bind to the created job. "link" (default)
  // claims the uploaded rows for this job; "copy" clones their metadata onto
  // this job, for sibling jobs of a fanned-out send whose originals were
  // already claimed by the first job. Copies are made before the job is
  // enqueued, so the worker never races an attachment write.
  attachmentMode?: "link" | "copy";
};

// Email addresses are case-insensitive in practice; every comparison downstream
// (suppression lookups, soft-bounce counting, the worker's cc/bcc strip) is an
// exact string match, so recipients are normalized once at the door.
function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export const transactionalEmailService = {
  async send(
    input: TransactionalSendInput
  ): Promise<TransactionalSendResponse> {
    const idempotencyKey = input.idempotencyKey?.trim() || null;

    const to = normalizeEmail(input.to);
    const cc = (input.cc ?? []).map(normalizeEmail).filter(Boolean);
    const bcc = (input.bcc ?? []).map(normalizeEmail).filter(Boolean);

    // Idempotency replay: a retry with a key we've already seen for this org
    // returns the original job without doing any work or sending again.
    if (idempotencyKey) {
      const existing = await prisma.emailJob.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: input.organizationId,
            idempotencyKey
          }
        },
        select: { id: true, status: true }
      });
      if (existing) {
        return { id: existing.id, status: existing.status };
      }
    }

    // Who this sends as. Three ways in, one answer: an explicit connection id,
    // an explicit `from` address resolved to the connection that owns it, or
    // the org default. A `from` that matches nothing is a 404 rather than a
    // fall back to the default — a typo must not quietly send as the wrong
    // identity. The id wins over `from` because it is the more specific
    // selector; a caller who sends both has already named the connection.
    const from = input.from ? normalizeEmail(input.from) : null;

    const smtpConnection = await prisma.sMTPConnection.findFirst({
      where: {
        organizationId: input.organizationId,
        ...(input.smtpConnectionId
          ? { id: input.smtpConnectionId }
          : from
            ? { fromEmail: { equals: from, mode: "insensitive" } }
            : { isDefault: true })
      },
      // `fromEmail` is not unique within an org — the same mailbox can be
      // configured twice against different SMTP hosts — so an address lookup
      // can match more than one row. Prefer the default, then the oldest, so
      // the same `from` always resolves to the same account.
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
    });

    if (!smtpConnection) {
      throw new HttpError(
        404,
        from
          ? `No sending account sends as ${from}`
          : "SMTP connection not found",
        "missing_smtp_connection"
      );
    }

    // Send-as enforcement (Phase 4): a MEMBER needs a grant for this
    // connection. Covers manual sends too (they delegate here with the
    // composer's user). API-key sends have no acting user and SYSTEM mail is
    // instance mail — both bypass inside assertMayUseConnection/here.
    if (input.origin !== "SYSTEM") {
      await assertMayUseConnection({
        userId: input.createdByUserId,
        organizationId: input.organizationId,
        smtpConnectionId: smtpConnection.id
      });
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

    // Suppression guard: if the recipient is on the org's "never send" list,
    // record a SUPPRESSED job (not a failure, not delivered) and stop before
    // enqueuing. SYSTEM mail (password resets, invitations) deliberately
    // bypasses this: a user who unsubscribed from marketing must still be able
    // to reset their password. The worker's re-check carries the same bypass.
    if (
      origin !== "SYSTEM" &&
      (await suppressionService.isSuppressed(input.organizationId, to))
    ) {
      const { job: suppressed } = await createEmailJob(
        {
          organizationId: input.organizationId,
          smtpConnectionId: smtpConnection.id,
          templateId: template?.id,
          toEmail: to,
          cc,
          bcc,
          replyTo: input.replyTo,
          inReplyTo: input.inReplyTo,
          references: input.references ?? [],
          idempotencyKey,
          origin,
          createdByUserId: input.createdByUserId,
          sendGroupId: input.sendGroupId,
          subject,
          html,
          text,
          variables: input.variables as InputJsonValue | undefined,
          status: "SUPPRESSED"
        },
        input.organizationId,
        idempotencyKey
      );
      return { id: suppressed.id, status: suppressed.status };
    }

    // Every send is queued: the email-sending worker is the single place SMTP
    // is spoken, so throttling, suppression re-checks, bounce classification,
    // retries, and cancellation all apply uniformly. A send without
    // `scheduledAt` is simply a queued job with no delay. The API's answer is
    // therefore "accepted", not "delivered" — callers poll the job status (or
    // consume webhooks) for the outcome.
    const { job: queuedJob, replayed } = await createEmailJob(
      {
        organizationId: input.organizationId,
        smtpConnectionId: smtpConnection.id,
        templateId: template?.id,
        toEmail: to,
        cc,
        bcc,
        replyTo: input.replyTo,
        inReplyTo: input.inReplyTo,
        references: input.references ?? [],
        idempotencyKey,
        origin,
        createdByUserId: input.createdByUserId,
        sendGroupId: input.sendGroupId,
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
      },
      input.organizationId,
      idempotencyKey
    );

    if (replayed) {
      return { id: queuedJob.id, status: queuedJob.status };
    }

    if (input.attachmentMode === "copy") {
      await attachmentService.copyToJob(
        input.attachmentIds,
        input.organizationId,
        queuedJob.id
      );
    } else {
      await attachmentService.linkToJob(
        input.attachmentIds,
        input.organizationId,
        queuedJob.id
      );
    }

    await emailSendingQueue.add(
      "send-email",
      { emailJobId: queuedJob.id },
      {
        delay: scheduledAt
          ? Math.max(0, scheduledAt.getTime() - Date.now())
          : 0,
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
};
