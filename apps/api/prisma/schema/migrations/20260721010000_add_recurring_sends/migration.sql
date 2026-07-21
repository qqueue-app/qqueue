-- Recurring compose sends.
--
-- Email Studio could schedule a one-off send but not a repeating one; the
-- recurrence UI existed and was hidden behind a TODO because there was no
-- model to persist it. Campaign recurrence could not be reused directly:
-- campaigns require a Template and a ContactList, while compose sends address
-- ad-hoc To/CC/BCC.
--
-- Each firing creates an ordinary EmailJob (origin MANUAL), so this is a new
-- entry point into the existing delivery pipeline, not a parallel one.
-- RecurringSendRun exists for idempotency: BullMQ may deliver a scheduled job
-- more than once, and the unique (recurringSendId, occurrenceKey) makes the
-- repeat a no-op instead of a duplicate email.
--
-- Additive only: two new tables and one new enum; no existing table changes.

-- CreateEnum
CREATE TYPE "RecurringSendStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateTable
CREATE TABLE "RecurringSend" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT,
    "text" TEXT,
    "to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "listIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "replyTo" TEXT,
    "smtpConnectionId" TEXT NOT NULL,
    "templateId" TEXT,
    "variables" JSONB,
    "cronExpression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "RecurringSendStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringSendRun" (
    "id" TEXT NOT NULL,
    "recurringSendId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "emailJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringSendRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringSend_organizationId_idx" ON "RecurringSend"("organizationId");

-- CreateIndex
CREATE INDEX "RecurringSend_status_nextRunAt_idx" ON "RecurringSend"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "RecurringSendRun_recurringSendId_idx" ON "RecurringSendRun"("recurringSendId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringSendRun_recurringSendId_occurrenceKey_key" ON "RecurringSendRun"("recurringSendId", "occurrenceKey");

-- AddForeignKey
ALTER TABLE "RecurringSend" ADD CONSTRAINT "RecurringSend_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSendRun" ADD CONSTRAINT "RecurringSendRun_recurringSendId_fkey" FOREIGN KEY ("recurringSendId") REFERENCES "RecurringSend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

