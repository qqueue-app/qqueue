import { Queue } from "bullmq";
import { redisConnection } from "../config/redis.js";

export interface RecurringSendJob {
  recurringSendId: string;
  /**
   * Stable identifier for a single firing. Job-scheduler fires omit it and the
   * worker falls back to the BullMQ job id (which embeds the fire timestamp),
   * exactly as campaign-processing does.
   */
  occurrenceKey?: string;
}

export const recurringSendQueue = new Queue<RecurringSendJob>(
  "recurring-send",
  {
    connection: redisConnection
  }
);

/** Scheduler id for a recurring send's repeatable job. */
export function recurringSendSchedulerId(recurringSendId: string): string {
  return `recurring-send-${recurringSendId}`;
}
