import { aggregateDeliveryStatus } from "@qqueue/shared";
import { prisma } from "./prisma.js";

/** Keep presentation separate from each delivery's own immutable SMTP outcome. */
export async function settleSendGroup(
  organizationId: string,
  sendGroupId: string | null
) {
  if (!sendGroupId) return;
  await prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId + ":group:" + sendGroupId}, 0))`;
    const jobs = await db.emailJob.findMany({
      where: { organizationId, sendGroupId },
      select: { status: true },
    });
    if (!jobs.length) return;
    const groupStatus = aggregateDeliveryStatus(jobs.map((job) => job.status))!;
    await db.emailJob.updateMany({
      where: { organizationId, sendGroupId, groupPrimary: true },
      data: { groupStatus },
    });
  });
}
