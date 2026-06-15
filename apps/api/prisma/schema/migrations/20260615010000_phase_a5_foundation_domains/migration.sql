-- Phase A.5: foundation domains for Email Studio.
--
-- Additive and backward compatible — every new column is nullable or defaulted,
-- so existing rows stay valid and current sends keep working. The one
-- structural change is contact-list membership: it moves from Prisma's implicit
-- M2M join ("_ContactToContactList") to an explicit "ContactListMember" table so
-- membership can carry metadata (addedAt, and later a source) and be
-- cursor-paginated for large campaign sends. Existing memberships are copied
-- over before the implicit join is dropped, so no membership is lost.

-- Contact: free-form tags for future segmentation/import.
ALTER TABLE "Contact" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ContactList: optional human description.
ALTER TABLE "ContactList" ADD COLUMN "description" TEXT;

-- Template: MJML source alongside the compiled, email-safe html.
ALTER TABLE "Template" ADD COLUMN "mjml" TEXT;

-- EmailJob: threading metadata (messageId already exists).
ALTER TABLE "EmailJob" ADD COLUMN     "inReplyTo" TEXT,
ADD COLUMN     "references" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable: explicit contact-list membership join.
CREATE TABLE "ContactListMember" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "contactListId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactListMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactListMember_contactId_idx" ON "ContactListMember"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactListMember_contactListId_contactId_key" ON "ContactListMember"("contactListId", "contactId");

-- CreateIndex
CREATE INDEX "ContactList_organizationId_idx" ON "ContactList"("organizationId");

-- CreateIndex
CREATE INDEX "Template_organizationId_idx" ON "Template"("organizationId");

-- AddForeignKey
ALTER TABLE "ContactListMember" ADD CONSTRAINT "ContactListMember_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactListMember" ADD CONSTRAINT "ContactListMember_contactListId_fkey" FOREIGN KEY ("contactListId") REFERENCES "ContactList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing implicit memberships into the explicit join. In the implicit
-- table, "A" references Contact and "B" references ContactList (Prisma orders
-- the columns alphabetically by model name). gen_random_uuid() supplies the new
-- primary keys (built into PostgreSQL 13+).
INSERT INTO "ContactListMember" ("id", "contactId", "contactListId", "addedAt")
SELECT gen_random_uuid()::text, "A", "B", CURRENT_TIMESTAMP
FROM "_ContactToContactList";

-- Drop the now-unused implicit join table.
DROP TABLE "_ContactToContactList";
