-- Domain access for mailbox provisioning: OWNERs may provision under any
-- Mailcow domain; ADMINs only under domains granted here (default deny).
CREATE TABLE "MailDomainGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailDomainGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailDomainGrant_organizationId_userId_domain_key"
    ON "MailDomainGrant"("organizationId", "userId", "domain");

CREATE INDEX "MailDomainGrant_organizationId_userId_idx"
    ON "MailDomainGrant"("organizationId", "userId");

ALTER TABLE "MailDomainGrant"
    ADD CONSTRAINT "MailDomainGrant_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MailDomainGrant"
    ADD CONSTRAINT "MailDomainGrant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
