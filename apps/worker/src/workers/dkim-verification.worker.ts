import { Worker } from "bullmq";
import { redisConnection } from "../config/redis.js";
import {
  verifyAllManagedDomains,
  verifySendingDomain
} from "../lib/dkim-verify.js";
import type { DkimVerificationJob } from "../queues/dkim-verification.queue.js";

export function startDkimVerificationWorker() {
  return new Worker<DkimVerificationJob>(
    "dkim-verification",
    async (job) => {
      // On-demand "Verify now" targets a single domain; the daily scheduler
      // fires with no id and rechecks every managed domain.
      if (job.data.sendingDomainId) {
        await verifySendingDomain(job.data.sendingDomainId);
      } else {
        await verifyAllManagedDomains();
      }
    },
    {
      // DNS lookups are I/O-bound and can be slow; keep concurrency modest.
      connection: redisConnection,
      concurrency: 3
    }
  );
}
