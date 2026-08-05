import type { SuppressionReason } from "@prisma/client";
import type { BounceType } from "@qqueue/email-engine";
import { env } from "../config/env.js";
import { prisma } from "./prisma.js";

// Suppression rows are stored lowercase; normalize lookups so a mixed-case
// recipient still matches.
function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** True when the address is on the org's suppression list. */
export async function isSuppressed(organizationId: string, email: string) {
  const hit = await prisma.suppression.findUnique({
    where: {
      organizationId_email: { organizationId, email: normalizeEmail(email) }
    },
    select: { id: true }
  });
  return Boolean(hit);
}

/**
 * Which of these addresses are suppressed, as a lowercase Set. One query for
 * the send worker's CC/BCC screen.
 */
export async function suppressedAmong(
  organizationId: string,
  emails: string[]
): Promise<Set<string>> {
  if (emails.length === 0) {
    return new Set();
  }
  const rows = await prisma.suppression.findMany({
    where: { organizationId, email: { in: emails.map(normalizeEmail) } },
    select: { email: true }
  });
  return new Set(rows.map((row) => row.email.toLowerCase()));
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
  const { organizationId, reason, source } = input;
  const email = normalizeEmail(input.email);
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
      emailJob: { toEmail: normalizeEmail(input.email) },
      metadata: { path: ["bounceType"], equals: "SOFT" }
    }
  });
  return softCount >= softBounceThreshold;
}
