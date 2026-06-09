import { prisma } from "./lib/prisma.js";
import { campaignProcessingQueue } from "./queues/campaign-processing.queue.js";
import { emailSendingQueue } from "./queues/email-sending.queue.js";
import { startCampaignProcessingWorker } from "./workers/campaign-processing.worker.js";
import { startEmailSendingWorker } from "./workers/email-sending.worker.js";

async function recoverQueuedWork() {
  const [campaigns, emailJobs] = await Promise.all([
    prisma.campaign.findMany({
      where: {
        OR: [
          { status: "SENDING" },
          { status: "SCHEDULED", scheduledAt: { lte: new Date() } }
        ]
      },
      select: { id: true }
    }),
    prisma.emailJob.findMany({
      where: { status: "QUEUED" },
      select: { id: true }
    })
  ]);

  if (campaigns.length > 0) {
    await campaignProcessingQueue.addBulk(
      campaigns.map((campaign) => ({
        name: "process-campaign",
        data: { campaignId: campaign.id },
        opts: {
          jobId: `campaign-${campaign.id}-recovery`,
          attempts: 3,
          backoff: { type: "exponential", delay: 30_000 }
        }
      }))
    );
  }

  if (emailJobs.length > 0) {
    await emailSendingQueue.addBulk(
      emailJobs.map((emailJob) => ({
        name: "send-email",
        data: { emailJobId: emailJob.id },
        opts: {
          jobId: `email-${emailJob.id}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 30_000 }
        }
      }))
    );
  }
}

const workers = [startEmailSendingWorker(), startCampaignProcessingWorker()];

await recoverQueuedWork();

for (const worker of workers) {
  worker.on("completed", (job) => {
    console.log(`Completed ${worker.name} job ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Failed ${worker.name} job ${job?.id}:`, error);
  });
}

console.log("QQueue workers started.");
