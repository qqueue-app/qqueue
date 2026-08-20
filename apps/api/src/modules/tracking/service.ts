import { z } from "zod";
import { classifyBounce, classifyOpen } from "@qqueue/email-engine";
import { emailAddressSchema } from "@qqueue/shared";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { suppressionService } from "../suppressions/service.js";
import { webhookEndpointService } from "../webhooks/service.js";

// A 1x1 fully transparent GIF, served as the open-tracking pixel.
export const TRACKING_PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export const webhookEventSchema = z.object({
  type: z.enum(["DELIVERED", "BOUNCED", "COMPLAINED"]),
  // Provider message id (preferred) or the QQueue email job id — either is
  // enough to find the originating send.
  messageId: z.string().min(1).optional(),
  emailJobId: z.string().min(1).optional(),
  email: emailAddressSchema.optional(),
  reason: z.string().optional(),
  // Some ESPs report whether a bounce is hard/soft. When omitted, the bounce is
  // classified from `reason`; an unclassifiable bounce defaults to hard.
  bounceType: z.enum(["HARD", "SOFT", "BLOCK"]).optional()
});

export type WebhookEventInput = z.infer<typeof webhookEventSchema>;

async function findJob(emailJobId: string) {
  return prisma.emailJob.findUnique({
    where: { id: emailJobId },
    // `sentAt` is read by open classification: an open arriving seconds after
    // the send is a machine pre-fetching, not a reader.
    select: { id: true, organizationId: true, toEmail: true, sentAt: true }
  });
}

/** What the pixel request itself tells us, lifted off the HTTP layer. */
export interface OpenContext {
  userAgent?: string | null;
  ip?: string | null;
}

/*
  User-Agents are attacker-controlled and unbounded; this column is JSON on the
  largest table in the schema. Long enough to keep every real client string,
  short enough that a hostile one can't be used to inflate a row.
*/
const MAX_USER_AGENT_LENGTH = 256;

/**
 * How long one email job's opens collapse into a single outbound webhook.
 *
 * Without this every pixel fetch queued its own `email.opened` delivery, with
 * five retries behind it — so one reader with the message on screen could send
 * a subscriber's endpoint a dozen POSTs about a single email. Subscribers want
 * to know the message was opened; they do not want a render log. The first
 * open in a window is delivered immediately, and the raw events remain on the
 * job for anyone who asks the API.
 */
const OPEN_WEBHOOK_WINDOW_SECONDS = 60 * 60;

/**
 * Claim the right to emit an `email.opened` webhook for this job, once per
 * window. `SET NX EX` so concurrent opens can't both win.
 *
 * Fails open: if Redis is unreachable we would rather send a duplicate webhook
 * than drop the only notification of an open — and in that state the delivery
 * queue (also Redis) is down too, so the enqueue below fails on its own.
 */
async function claimOpenWebhookSlot(emailJobId: string): Promise<boolean> {
  try {
    const claimed = await redis.set(
      `open-webhook:${emailJobId}`,
      "1",
      "EX",
      OPEN_WEBHOOK_WINDOW_SECONDS,
      "NX"
    );
    return claimed === "OK";
  } catch (error) {
    logger.warn(
      { err: error, emailJobId },
      "open webhook debounce unavailable; emitting"
    );
    return true;
  }
}

export const trackingService = {
  /**
   * Record an open. An open is an open — it does not also record DELIVERED.
   *
   * This used to synthesize a one-time DELIVERED alongside the first open, on
   * the reasoning that an open implies delivery. It does, but the converse is
   * what the reporting then assumed: with no ESP webhook configured (the normal
   * self-hosted case) the *only* author of DELIVERED was this line, so the
   * deliverability dashboard's "delivery rate" was the open rate wearing
   * another label, and read as though most mail had failed. Delivery is
   * reported only from sources that observe it — an ESP webhook, or a DSN.
   * Consumers who want the open signal already receive the OPENED event.
   */
  async recordOpen(emailJobId: string, context: OpenContext = {}) {
    const job = await findJob(emailJobId);
    if (!job) {
      return;
    }

    const secondsSinceSent = job.sentAt
      ? (Date.now() - job.sentAt.getTime()) / 1000
      : null;
    const userAgent =
      context.userAgent?.slice(0, MAX_USER_AGENT_LENGTH).trim() || null;
    const classification = classifyOpen({ userAgent, secondsSinceSent });

    /*
      Every open carries the evidence it was judged on, not just the verdict.
      The heuristics will be wrong sometimes and will change; a row that records
      only "automated: true" can never be re-examined, whereas one that keeps
      the agent string and the elapsed time can be re-classified later against
      the same facts.
    */
    const event = await prisma.emailEvent.create({
      data: {
        organizationId: job.organizationId,
        emailJobId,
        type: "OPENED",
        metadata: {
          ...(userAgent ? { userAgent } : {}),
          ...(context.ip ? { ip: context.ip } : {}),
          ...(secondsSinceSent !== null
            ? { secondsSinceSent: Math.round(secondsSinceSent) }
            : {}),
          ...(classification.automated
            ? { automated: true, automatedReason: classification.reason }
            : {})
        }
      }
    });

    // A scanner fetching the pixel is not news. Notifying a subscriber that
    // their mail was "opened" by a security appliance is worse than silence:
    // it is a false engagement signal they will act on.
    if (classification.automated) {
      return;
    }

    if (await claimOpenWebhookSlot(emailJobId)) {
      await webhookEndpointService.enqueueForEmailEvent(event.id);
    }
  },

  /** Record a link click. `url` is the verified original destination. */
  async recordClick(emailJobId: string, url: string) {
    const job = await findJob(emailJobId);
    if (!job) {
      return;
    }

    const event = await prisma.emailEvent.create({
      data: {
        organizationId: job.organizationId,
        emailJobId,
        type: "CLICKED",
        metadata: { url }
      }
    });

    await webhookEndpointService.enqueueForEmailEvent(event.id);
  },

  /**
   * Record a normalized ESP webhook (bounce/complaint/delivered). Correlates by
   * provider messageId, falling back to the email job id. Hard bounces and
   * complaints also mark the matching contact so it is skipped on future sends.
   * Returns false when no matching email job is found.
   */
  async recordWebhookEvent(input: WebhookEventInput) {
    const job = input.emailJobId
      ? await findJob(input.emailJobId)
      : input.messageId
        ? await prisma.emailJob.findFirst({
            where: { messageId: input.messageId },
            select: { id: true, organizationId: true, toEmail: true },
            orderBy: { createdAt: "desc" }
          })
        : null;

    if (!job) {
      return false;
    }

    // Classify bounces so a transient (soft) bounce doesn't immediately
    // suppress. Complaints always suppress and need no classification.
    const bounceType =
      input.type === "BOUNCED"
        ? input.bounceType ?? classifyBounce({ message: input.reason })
        : undefined;

    const event = await prisma.emailEvent.create({
      data: {
        organizationId: job.organizationId,
        emailJobId: job.id,
        type: input.type,
        metadata: {
          source: "webhook",
          ...(input.reason ? { reason: input.reason } : {}),
          ...(input.messageId ? { messageId: input.messageId } : {}),
          ...(bounceType ? { bounceType } : {})
        }
      }
    });

    await webhookEndpointService.enqueueForEmailEvent(event.id);

    if (input.type === "BOUNCED" || input.type === "COMPLAINED") {
      const email = input.email ?? job.toEmail;
      // Complaints suppress immediately; bounces go through the soft/hard
      // threshold policy (the just-recorded BOUNCED event is counted).
      const suppress =
        input.type === "COMPLAINED" ||
        (await suppressionService.shouldSuppressBounce({
          organizationId: job.organizationId,
          email,
          bounceType: bounceType ?? "HARD"
        }));

      if (suppress) {
        await prisma.contact.updateMany({
          where: { organizationId: job.organizationId, email },
          data: { status: "BOUNCED" }
        });
        // Add to the org-wide suppression registry so the address is skipped on
        // every future send, not only sends to a matching Contact row.
        await suppressionService.addSuppression({
          organizationId: job.organizationId,
          email,
          reason: input.type === "COMPLAINED" ? "COMPLAINT" : "BOUNCE",
          source: "webhook"
        });
      }
    }

    return true;
  }
};
