import type { SuppressionReason } from "@prisma/client";
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
