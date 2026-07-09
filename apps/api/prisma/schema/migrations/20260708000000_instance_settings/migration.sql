-- First-run onboarding: instance-wide settings + instance-admin flag.
--
-- InstanceSetting is a sparse key-value store for install-scope runtime
-- settings (registration policy, setup-completion marker). An absent key means
-- "use the env/default value"; key names and value shapes are owned by
-- apps/api/src/lib/instance-settings.ts.
--
-- Backfills below make this a no-op for existing installs: any database that
-- already has users keeps open registration and never sees the setup wizard,
-- and OWNERs of the oldest organization become instance admins.

-- CreateTable
CREATE TABLE "InstanceSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceSetting_pkey" PRIMARY KEY ("key")
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "isInstanceAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Backfill for existing installs (any install that already has users): keep
-- registration open and mark setup complete so the wizard/resume never shows.
INSERT INTO "InstanceSetting" ("key", "value", "updatedAt")
SELECT 'allowPublicRegistration', 'true'::jsonb, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "User");

INSERT INTO "InstanceSetting" ("key", "value", "updatedAt")
SELECT 'setupCompletedAt',
       to_jsonb(to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
       CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "User");

-- Grant instance-admin to OWNERs of the oldest organization so existing
-- installs have someone who can manage instance settings immediately.
UPDATE "User" SET "isInstanceAdmin" = true
WHERE "id" IN (
  SELECT om."userId" FROM "OrganizationMember" om
  WHERE om."role" = 'OWNER'
    AND om."organizationId" = (
      SELECT o."id" FROM "Organization" o ORDER BY o."createdAt" ASC LIMIT 1
    )
);
