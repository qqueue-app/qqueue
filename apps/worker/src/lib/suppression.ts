import type { SuppressionReason } from "@prisma/client";
import type { BounceType } from "@qqueue/email-engine";
import { env } from "../config/env.js";
import { prisma } from "./prisma.js";

/** True when the address is on the org's suppression list. */
export async function isSuppressed(organizationId: string, email: string) {
  const hit = await prisma.suppression.findUnique({
    where: { organizationId_email: { organizationId, email } },
    select: { id: true }
  });
  return Boolean(hit);
}

/**
 * Idempotent insert keyed on the unique (organizationId, email). Mirrors the
 * API's suppressionService so the worker can suppress on a hard bounce without
 * reaching across apps.
 */
export function addSuppression(input: {
  organizationId: string;
  email: string;
  reason: SuppressionReason;
  source?: string;
}) {
  const { organizationId, email, reason, source } = input;
  return prisma.suppression.upsert({
    where: { organizationId_email: { organizationId, email } },
    create: { organizationId, email, reason, source },
    update: { reason, source }
  });
}

/**
 * Decide whether a bounce should suppress the address now. Mirrors the API's
 * `suppressionService.shouldSuppressBounce` (the worker can't reach across
 * apps). Hard/block bounces suppress immediately; a soft bounce only suppresses
 * once the org's soft-bounce count for the address within the window reaches the
 * threshold. Call AFTER recording the BOUNCED event so the current bounce counts.
 */
export async function shouldSuppressBounce(input: {
  organizationId: string;
  email: string;
  bounceType: BounceType;
}) {
  if (input.bounceType !== "SOFT") {
    return true;
  }

  const policy = await prisma.suppressionPolicy.findUnique({
    where: { organizationId: input.organizationId }
  });
  const softBounceThreshold =
    policy?.softBounceThreshold ?? env.SOFT_BOUNCE_THRESHOLD;
  const softBounceWindowDays =
    policy?.softBounceWindowDays ?? env.SOFT_BOUNCE_WINDOW_DAYS;

  const windowStart = new Date(
    Date.now() - softBounceWindowDays * 24 * 60 * 60 * 1000
  );
  const softCount = await prisma.emailEvent.count({
    where: {
      organizationId: input.organizationId,
      type: "BOUNCED",
      occurredAt: { gte: windowStart },
      emailJob: { toEmail: input.email },
      metadata: { path: ["bounceType"], equals: "SOFT" }
    }
  });
  return softCount >= softBounceThreshold;
}
