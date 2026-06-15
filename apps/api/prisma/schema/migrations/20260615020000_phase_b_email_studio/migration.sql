-- Phase B: Email Studio.
--
-- Adds the EmailDraft table backing the manual composer's draft persistence
-- (save, resume, delete). Drafts are organization- and user-scoped snapshots of
-- in-progress composer state; sending a draft produces an EmailJob (origin =
-- MANUAL) through the existing shared send pipeline, so nothing else in the
-- schema changes. Additive only — no existing table is touched.

-- CreateTable
CREATE TABLE "EmailDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "smtpConnectionId" TEXT,
    "templateId" TEXT,
    "subject" TEXT NOT NULL DEFAULT '',
    "html" TEXT,
    "text" TEXT,
    "to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "listIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "replyTo" TEXT,
    "variables" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailDraft_organizationId_createdByUserId_idx" ON "EmailDraft"("organizationId", "createdByUserId");

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
