-- Simplify the inbox to conversation viewing and replies only.
-- Remove support workflow metadata and internal notes from the core schema.
DROP INDEX IF EXISTS "InboundMessage_organizationId_assignedToUserId_idx";
DROP INDEX IF EXISTS "InboundMessage_organizationId_status_idx";
DROP INDEX IF EXISTS "InboundMessage_organizationId_priority_idx";
DROP INDEX IF EXISTS "InboundMessageNote_organizationId_inboundMessageId_idx";
DROP INDEX IF EXISTS "InboundMessageNote_authorUserId_idx";

ALTER TABLE "InboundMessage"
  DROP COLUMN IF EXISTS "assignedToUserId",
  DROP COLUMN IF EXISTS "status",
  DROP COLUMN IF EXISTS "priority",
  DROP COLUMN IF EXISTS "routedTo";

DROP TABLE IF EXISTS "InboundMessageNote";

DROP TYPE IF EXISTS "InboundMessageStatus";
DROP TYPE IF EXISTS "InboundMessagePriority";
