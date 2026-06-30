import { Queue } from "bullmq";
import { redisConnection } from "../config/redis.js";

export interface DkimVerificationJob {
  // A specific domain to verify (on-demand "Verify now"); omitted by the daily
  // recheck scheduler, which rechecks every managed domain.
  sendingDomainId?: string;
}

export const dkimVerificationQueue = new Queue<DkimVerificationJob>(
  "dkim-verification",
  {
    connection: redisConnection
  }
);
