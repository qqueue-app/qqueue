-- Remove external ticket references from the inbox. Ticketing is not part of
-- the focused inbox workflow.
DROP INDEX IF EXISTS "InboundMessage_organizationId_externalTicketProvider_extern_idx";
DROP INDEX IF EXISTS "InboundMessage_organizationId_externalTicketProvider_externalTicketKey_idx";

ALTER TABLE "InboundMessage"
  DROP COLUMN IF EXISTS "externalTicketProvider",
  DROP COLUMN IF EXISTS "externalTicketKey",
  DROP COLUMN IF EXISTS "externalTicketUrl";

DROP TYPE IF EXISTS "TicketProvider";
