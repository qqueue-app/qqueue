-- Phase 2b: async bounce processing. Inbox sync now recognizes delivery status
-- notifications (DSNs) and feeds them into bounce accounting; the flag marks
-- those rows so the inbox can separate bounce reports from human mail.
ALTER TABLE "InboundMessage" ADD COLUMN "isDsn" BOOLEAN NOT NULL DEFAULT false;
