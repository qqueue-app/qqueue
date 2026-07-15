import type { Prisma } from "@prisma/client";
import { INSTANCE_SETTING_KEYS } from "@qqueue/shared";
import { prisma } from "./prisma.js";

/**
 * Instance-wide runtime settings, stored as sparse key-value rows in the
 * InstanceSetting table. An absent row means "use the default below", so the
 * table stays empty until something is explicitly configured. Defaults keep
 * pre-onboarding installs unchanged: registration stays open and no setup
 * wizard is offered (the migration backfills setupCompletedAt for them).
 */
export interface InstanceSettings {
  /** May anyone reach /register, or only the bootstrap first user? */
  allowPublicRegistration: boolean;
  /** ISO timestamp when the first-run wizard finished; null = not finished. */
  setupCompletedAt: string | null;
}

const DEFAULTS: InstanceSettings = {
  allowPublicRegistration: true,
  setupCompletedAt: null
};

const CACHE_TTL_MS = 10_000;

let cache: { value: InstanceSettings; expiresAt: number } | null = null;

function readValue<T>(
  rows: Map<string, Prisma.JsonValue>,
  key: string,
  isValid: (value: Prisma.JsonValue) => value is Prisma.JsonValue & T,
  fallback: T
): T {
  if (!rows.has(key)) {
    return fallback;
  }
  const value = rows.get(key) as Prisma.JsonValue;
  if (!isValid(value)) {
    console.warn(
      `[instance-settings] Ignoring malformed value for "${key}"; using default.`
    );
    return fallback;
  }
  return value;
}

const isBoolean = (value: Prisma.JsonValue): value is boolean =>
  typeof value === "boolean";
const isString = (value: Prisma.JsonValue): value is string =>
  typeof value === "string";

export async function getInstanceSettings(): Promise<InstanceSettings> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.value;
  }

  const rows = await prisma.instanceSetting.findMany({
    where: { key: { in: Object.values(INSTANCE_SETTING_KEYS) } }
  });
  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  const value: InstanceSettings = {
    allowPublicRegistration: readValue(
      byKey,
      INSTANCE_SETTING_KEYS.allowPublicRegistration,
      isBoolean,
      DEFAULTS.allowPublicRegistration
    ),
    setupCompletedAt: readValue(
      byKey,
      INSTANCE_SETTING_KEYS.setupCompletedAt,
      isString,
      DEFAULTS.setupCompletedAt
    )
  };

  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/**
 * Upserts the given settings. Accepts a transaction client so callers (e.g.
 * the first-user registration) can write atomically with their own changes.
 */
export async function setInstanceSettings(
  partial: { allowPublicRegistration?: boolean; setupCompletedAt?: string },
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) {
      continue;
    }
    await tx.instanceSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });
  }
  invalidateInstanceSettingsCache();
}

export function invalidateInstanceSettingsCache(): void {
  cache = null;
}
