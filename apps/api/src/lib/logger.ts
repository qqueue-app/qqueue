import pino from "pino";
import { env } from "../config/env.js";

/**
 * Structured application logger (Phase 5). One JSON line per event, with
 * request/job context as fields instead of prose — so an operator can grep a
 * reqId across the request log, the error log, and the enqueued jobId.
 *
 * Silent under test; pretty-printing is deliberately not built in — pipe
 * through `pino-pretty` locally when needed.
 */
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : (process.env.LOG_LEVEL ?? "info"),
  base: undefined, // no pid/hostname noise; container runtimes add their own
});
