-- Phase E inbox workflows: lightweight routing state, support status, and
-- optional external ticket references. These fields are intentionally additive
-- so the optional inbox module remains safe to enable after earlier Phase E
-- migrations.
CREATE TYPE "InboundMessageStatus" AS ENUM ('OPEN', 'PENDING', 'CLOSED');
CREATE TYPE "InboundMessagePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "TicketProvider" AS ENUM ('JIRA', 'LINEAR', 'GITHUB', 'ZENDESK', 'OTHER');

ALTER TABLE "InboundMessage"
  ADD COLUMN "status" "InboundMessageStatus" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "priority" "InboundMessagePriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "routedTo" TEXT,
  ADD COLUMN "externalTicketProvider" "TicketProvider",
  ADD COLUMN "externalTicketKey" TEXT,
  ADD COLUMN "externalTicketUrl" TEXT;

CREATE INDEX "InboundMessage_organizationId_status_idx"
  ON "InboundMessage"("organizationId", "status");

CREATE INDEX "InboundMessage_organizationId_priority_idx"
  ON "InboundMessage"("organizationId", "priority");

CREATE INDEX "InboundMessage_organizationId_externalTicketProvider_externalTicketKey_idx"
  ON "InboundMessage"("organizationId", "externalTicketProvider", "externalTicketKey");
