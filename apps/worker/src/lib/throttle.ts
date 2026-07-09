import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { redisConnection } from "../config/redis.js";
import { prisma } from "./prisma.js";

const WINDOW_MS = 60_000;

// A dedicated Redis client for the throttle counters. Separate from BullMQ's
// connection so command traffic doesn't interfere with queue operations.
export const throttleRedis = new Redis({
  ...redisConnection,
  maxRetriesPerRequest: null,
  lazyConnect: true
});

/** The recipient's lowercased domain, or null if the address has no `@`. */
export function recipientDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1 || at === email.length - 1) {
    return null;
  }
  return email.slice(at + 1).toLowerCase();
}

/**
 * Resolve the effective per-minute cap for a domain: a row for the exact domain
 * wins, then the org-wide default row (domain ""), then the env default.
 */
export function resolveCap(
  rows: Array<{ domain: string; maxPerMinute: number }>,
  domain: string,
  fallback: number
): number {
  const exact = rows.find((r) => r.domain === domain);
  if (exact) {
    return exact.maxPerMinute;
  }
  const orgDefault = rows.find((r) => r.domain === "");
  return orgDefault?.maxPerMinute ?? fallback;
}

export interface ThrottleDecision {
  allowed: boolean;
  /** When not allowed, how long to wait before retrying (ms). */
  retryInMs?: number;
}

/**
 * Reserve a send slot for the recipient's domain within the current one-minute
 * window. Increments a Redis fixed-window counter (mirroring the API's
 * rate-limit pattern) and denies once the effective cap is exceeded, returning
 * the delay until the next window. Addresses with no parseable domain are never
 * throttled.
 */
export async function reserveDomainSlot(
  organizationId: string,
  email: string
): Promise<ThrottleDecision> {
  const domain = recipientDomain(email);
  if (!domain) {
    return { allowed: true };
  }

  const rows = await prisma.domainThrottle.findMany({
    where: { organizationId, OR: [{ domain }, { domain: "" }] },
    select: { domain: true, maxPerMinute: true }
  });
  const cap = resolveCap(rows, domain, env.DEFAULT_DOMAIN_MAX_PER_MINUTE);

  const now = Date.now();
  const bucket = Math.floor(now / WINDOW_MS);
  const key = `throttle:${organizationId}:${domain}:${bucket}`;

  const count = await throttleRedis.incr(key);
  if (count === 1) {
    await throttleRedis.pexpire(key, WINDOW_MS);
  }

  if (count > cap) {
    // Delay to the start of the next window (+1ms) so the retry lands on a fresh
    // counter rather than re-incrementing the current, already-exhausted one.
    return { allowed: false, retryInMs: WINDOW_MS - (now % WINDOW_MS) + 1 };
  }
  return { allowed: true };
}
