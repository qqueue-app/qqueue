import type { InstanceSettingsUpdateInput } from "@qqueue/shared";
import { env } from "../../config/env.js";
import {
  getInstanceSettings,
  setInstanceSettings
} from "../../lib/instance-settings.js";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";

async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 2_000)
      )
    ]);
    return pong === "PONG";
  } catch {
    return false;
  }
}

export const instanceSettingsService = {
  async get() {
    const settings = await getInstanceSettings();
    return {
      allowPublicRegistration: settings.allowPublicRegistration,
      setupCompletedAt: settings.setupCompletedAt
    };
  },

  async update(input: InstanceSettingsUpdateInput) {
    await setInstanceSettings(input);
    return this.get();
  },

  /**
   * Presence/health view of env-derived config for the Settings page. Reports
   * booleans and non-secret values only — never secret material. The always-
   * required secrets (JWT/encryption/tracking) are omitted because the process
   * cannot boot without them.
   */
  async envStatus() {
    const [databaseOk, redisOk] = await Promise.all([
      checkDatabase(),
      checkRedis()
    ]);

    return {
      database: { ok: databaseOk },
      redis: { ok: redisOk, host: env.REDIS_HOST, port: env.REDIS_PORT },
      storage: {
        endpoint: env.S3_ENDPOINT || "aws-default",
        bucket: env.S3_BUCKET
      },
      secrets: {
        webhookSecretConfigured: Boolean(env.WEBHOOK_SECRET)
      },
      urls: {
        appUrl: env.APP_URL,
        publicAppUrl: env.PUBLIC_APP_URL,
        webOrigin: env.WEB_ORIGIN ?? null
      },
      tunables: {
        softBounceThreshold: env.SOFT_BOUNCE_THRESHOLD,
        softBounceWindowDays: env.SOFT_BOUNCE_WINDOW_DAYS,
        defaultDomainMaxPerMinute: env.DEFAULT_DOMAIN_MAX_PER_MINUTE,
        attachmentMaxBytes: env.ATTACHMENT_MAX_BYTES
      }
    };
  }
};
