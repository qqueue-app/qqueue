import { CronExpressionParser } from "cron-parser";

/** Next fire time for a cron expression in the given timezone, or null. */
export function nextCronRun(
  cronExpression: string,
  timezone: string | null | undefined,
  from: Date = new Date()
): Date | null {
  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: from,
      tz: timezone ?? "UTC"
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}
