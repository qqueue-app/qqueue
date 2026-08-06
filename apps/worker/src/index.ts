import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { recoverQueuedWork } from "./lib/recovery.js";
import { inboxSyncQueue } from "./queues/inbox-sync.queue.js";
import { startCampaignProcessingWorker } from "./workers/campaign-processing.worker.js";
import { startEmailSendingWorker } from "./workers/email-sending.worker.js";
import { startInboxSyncWorker } from "./workers/inbox-sync.worker.js";
import { startRecurringSendWorker } from "./workers/recurring-send.worker.js";
import { startWebhookDeliveryWorker } from "./workers/webhook-delivery.worker.js";

// Crash visibility (Phase 5): a rejected promise nobody awaited used to vanish
// silently. Log it loudly; keep the process up for unhandled rejections (the
// BullMQ workers are supervised and per-job errors are already handled), but
// treat uncaught exceptions as fatal — state after one is unknowable.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "uncaught exception, exiting");
  process.exit(1);
});

async function scheduleInboxSync() {
  await inboxSyncQueue.upsertJobScheduler(
    "inbox-sync-active-accounts",
    { every: env.INBOX_SYNC_INTERVAL_SECONDS * 1000 },
    {
      name: "sync-inbox",
      data: {},
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
      },
    }
  );
}

const workers = [
  startEmailSendingWorker(),
  startCampaignProcessingWorker(),
  startWebhookDeliveryWorker(),
  startInboxSyncWorker(),
  startRecurringSendWorker(),
];

// Graceful shutdown (Phase 5): worker.close() waits for in-flight jobs, so a
// deploy or `docker stop` never kills a send mid-SMTP-conversation and never
// strands an EmailJob in PROCESSING (that recovery path stays as the backstop
// for hard crashes).
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "shutdown signal received; finishing in-flight jobs");
  await Promise.allSettled(workers.map((worker) => worker.close()));
  await prisma.$disconnect().catch(() => undefined);
  logger.info("shut down cleanly");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await recoverQueuedWork();
await scheduleInboxSync();

for (const worker of workers) {
  worker.on("completed", (job) => {
    logger.info({ queue: worker.name, jobId: job.id }, "job completed");
  });

  worker.on("failed", (job, error) => {
    logger.error({ queue: worker.name, jobId: job?.id, err: error }, "job failed");
  });
}

logger.info("QQueue workers started");
