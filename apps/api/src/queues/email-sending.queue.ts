import { Queue } from "bullmq";
import { env } from "../config/env.js";

export interface EmailSendingJob {
  emailJobId: string;
}

export const emailSendingQueue = new Queue<EmailSendingJob>("email-sending", {
  connection: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT
  }
});
