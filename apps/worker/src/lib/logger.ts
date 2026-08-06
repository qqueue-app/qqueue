import pino from "pino";

/**
 * Structured worker logger, mirroring the API's (Phase 5): one JSON line per
 * event with job/queue context as fields, so a worker-side failure can be
 * grepped by emailJobId alongside the API's request log. Silent under vitest;
 * pipe through `pino-pretty` locally when needed.
 */
export const logger = pino({
  level:
    process.env.NODE_ENV === "test" || process.env.VITEST
      ? "silent"
      : (process.env.LOG_LEVEL ?? "info"),
  base: undefined, // no pid/hostname noise; container runtimes add their own
});
