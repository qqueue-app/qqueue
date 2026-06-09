import { Queue } from "bullmq";
import { redisConnection } from "../config/redis.js";

export interface EmailSendingJob {
  emailJobId: string;
}

export const emailSendingQueue = new Queue<EmailSendingJob>("email-sending", {
  connection: redisConnection
});
