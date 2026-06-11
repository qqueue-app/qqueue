import type { Job, Queue } from "bullmq";
import { HttpError } from "../../lib/http-error.js";
import { campaignProcessingQueue } from "../../queues/campaign-processing.queue.js";
import { emailSendingQueue } from "../../queues/email-sending.queue.js";
import { webhookDeliveryQueue } from "../../queues/webhook-delivery.queue.js";

const queues = {
  "email-sending": emailSendingQueue as Queue,
  "campaign-processing": campaignProcessingQueue as Queue,
  "webhook-delivery": webhookDeliveryQueue as Queue
};

type QueueName = keyof typeof queues;

function resolveQueue(queueName: string) {
  const queue = queues[queueName as QueueName];
  if (!queue) {
    throw new HttpError(404, "Queue not found", "not_found");
  }
  return queue;
}

async function serializeJob(job: Job | undefined) {
  if (!job) {
    return null;
  }

  return {
    id: String(job.id),
    name: job.name,
    queueName: job.queueName,
    data: job.data,
    attemptsMade: job.attemptsMade,
    attempts: job.opts.attempts ?? 0,
    timestamp: new Date(job.timestamp).toISOString(),
    processedOn: job.processedOn
      ? new Date(job.processedOn).toISOString()
      : null,
    finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    failedReason: job.failedReason ?? null
  };
}

export const queueOperationsService = {
  async summary() {
    const entries = await Promise.all(
      Object.entries(queues).map(async ([name, queue]) => {
        const [counts, queuedJobs, processingJobs, failedJobs] =
          await Promise.all([
            queue.getJobCounts(
              "waiting",
              "delayed",
              "active",
              "failed",
              "completed"
            ),
            queue.getJobs(["waiting", "delayed"], 0, 24, true),
            queue.getJobs(["active"], 0, 24, true),
            queue.getJobs(["failed"], 0, 24, false)
          ]);

        return {
          name,
          counts: {
            queued: (counts.waiting ?? 0) + (counts.delayed ?? 0),
            processing: counts.active ?? 0,
            failed: counts.failed ?? 0,
            completed: counts.completed ?? 0
          },
          queuedJobs: await Promise.all(queuedJobs.map(serializeJob)),
          processingJobs: await Promise.all(processingJobs.map(serializeJob)),
          failedJobs: await Promise.all(failedJobs.map(serializeJob))
        };
      })
    );

    return entries;
  },

  async retry(queueName: string, jobId: string) {
    const queue = resolveQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new HttpError(404, "Job not found", "not_found");
    }

    const state = await job.getState();
    if (state !== "failed") {
      throw new HttpError(409, "Only failed jobs can be retried", "conflict");
    }

    await job.retry("failed");
    return serializeJob(job);
  }
};
