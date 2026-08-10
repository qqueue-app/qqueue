-- Push subscriptions belong to a device, not to an organization.
--
-- A PushSubscription carried an organizationId, which made one installed client
-- serve exactly one org. Three things fell out of that, all of them invisible
-- in the UI:
--
--   * Switching orgs did not re-register, so the toggle read "on" while the
--     device was still bound to the org you left.
--   * The upsert keys on endpoint, so toggling off and on again while in
--     another org *moved* the device there and silently ended the first org's
--     alerts on it.
--   * A person in two orgs could never be notified about both on one phone.
--
-- A device belongs to a person. Which org's mail may reach them is a
-- preference, and preferences belong on the membership — one answer per
-- (user, org), the same on every device they own.
--
-- Ordering matters: the backfill reads PushSubscription.organizationId, so the
-- column is dropped only after the preference has been derived from it.

-- CreateEnum
CREATE TYPE "InboxNotifyLevel" AS ENUM ('ALL', 'ADDRESSED_TO_ME', 'NONE');

-- AlterTable: default ALL, which is the right default for a *new* membership in
-- a shared team inbox — you joined the org to work its mail.
ALTER TABLE "OrganizationMember"
    ADD COLUMN "notifyLevel" "InboxNotifyLevel" NOT NULL DEFAULT 'ALL';

-- Backfill. The default above is wrong for rows that predate this migration:
-- applying it would hand everyone alerts for every org they belong to, which is
-- an upgrade quietly making people's phones louder. The rule is to reproduce
-- exactly the reach each person has today — silence everywhere, then re-enable
-- only the (user, org) pairs that actually have a registered device for that
-- org right now.
UPDATE "OrganizationMember" SET "notifyLevel" = 'NONE';

UPDATE "OrganizationMember" m
   SET "notifyLevel" = 'ALL'
  FROM "PushSubscription" s
 WHERE s."userId" = m."userId"
   AND s."organizationId" = m."organizationId";

-- DropForeignKey
ALTER TABLE "PushSubscription" DROP CONSTRAINT "PushSubscription_organizationId_fkey";

-- DropIndex
DROP INDEX "PushSubscription_organizationId_idx";

-- AlterTable
ALTER TABLE "PushSubscription" DROP COLUMN "organizationId";
