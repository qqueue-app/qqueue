import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { MailSearchInput, MailSearchRow } from "@qqueue/shared";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import { resolveMailboxAccess } from "../../lib/mailbox-access.js";

function fingerprint(
  input: MailSearchInput,
  organizationId: string,
  userId: string
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        organizationId,
        userId,
        input.view,
        input.q ?? "",
        input.mailbox ?? "",
      ])
    )
    .digest("hex")
    .slice(0, 24);
}
export function searchCursor(
  input: MailSearchInput,
  organizationId: string,
  userId: string
) {
  if (!input.cursor) return;
  try {
    const parsed = JSON.parse(
      Buffer.from(input.cursor, "base64url").toString()
    ) as { at: string; id: string; kind: string; scope: string };
    if (
      parsed.scope !== fingerprint(input, organizationId, userId) ||
      typeof parsed.id !== "string" ||
      typeof parsed.at !== "string" ||
      !parsed.id ||
      parsed.id.length > 128 ||
      !["RECEIVED", "SENT", "DRAFT"].includes(parsed.kind) ||
      !Number.isFinite(Date.parse(parsed.at))
    )
      throw new Error();
    return { ...parsed, at: new Date(parsed.at) };
  } catch {
    throw new HttpError(
      400,
      "This search page is no longer valid. Start the search again.",
      "validation_error"
    );
  }
}
type RawRow = Omit<MailSearchRow, "at" | "scheduledAt"> & {
  at: Date;
  scheduledAt: Date | null;
};
export const mailSearchService = {
  async mailboxes(organizationId: string, userId: string) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const [incoming, outgoing] = await Promise.all([
      prisma.inboxAccount.findMany({
        where: {
          organizationId,
          ...(access.unrestricted
            ? {}
            : { id: { in: access.inboxAccountIds } }),
        },
        select: { email: true, name: true },
      }),
      prisma.sMTPConnection.findMany({
        where: {
          organizationId,
          ...(access.unrestricted
            ? {}
            : { id: { in: access.smtpConnectionIds } }),
        },
        select: { fromEmail: true, name: true },
      }),
    ]);
    return [
      ...new Map(
        [
          ...incoming.map((account) => ({
            email: account.email.toLowerCase(),
            name: account.name,
          })),
          ...outgoing.map((account) => ({
            email: account.fromEmail.toLowerCase(),
            name: account.name,
          })),
        ].map((account) => [account.email, account])
      ).values(),
    ].sort((a, b) => a.email.localeCompare(b.email));
  },
  async search(organizationId: string, userId: string, input: MailSearchInput) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const cursor = searchCursor(input, organizationId, userId);
    const receivedScope = access.unrestricted
      ? Prisma.sql`TRUE`
      : access.inboxAccountIds.length
        ? Prisma.sql`m."inboxAccountId" IN (${Prisma.join(access.inboxAccountIds)})`
        : Prisma.sql`FALSE`;
    const sentAccess = access.unrestricted
      ? Prisma.sql`TRUE`
      : Prisma.sql`(j."createdByUserId"=${userId} OR ${access.smtpConnectionIds.length ? Prisma.sql`j."smtpConnectionId" IN (${Prisma.join(access.smtpConnectionIds)})` : Prisma.sql`FALSE`})`;
    const sentScope = Prisma.sql`(${sentAccess}) AND ${
      access.revokedSmtpConnectionIds?.length
        ? Prisma.sql`(j."smtpConnectionId" IS NULL OR j."smtpConnectionId" NOT IN (${Prisma.join(access.revokedSmtpConnectionIds)}))`
        : Prisma.sql`TRUE`
    }`;
    const currentFolder = (role: string) =>
      Prisma.sql`EXISTS (SELECT 1 FROM "InboundMessageLocation" l JOIN "InboxFolder" f ON f.id=l."inboxFolderId" WHERE l."inboundMessageId"=m.id AND l.present AND f.present AND f.role=${role})`;
    const incomingView =
      input.view === "ALL" || input.view === "RECEIVED"
        ? Prisma.sql`TRUE`
        : input.view === "SENT"
          ? currentFolder("SENT")
          : input.view === "DRAFTS"
            ? currentFolder("DRAFTS")
            : Prisma.sql`FALSE`;
    const outgoingView =
      input.view === "OUTBOX"
        ? Prisma.sql`j.origin='MANUAL' AND COALESCE(j."groupStatus",j.status)::text IN ('PENDING','QUEUED','PROCESSING')`
        : input.view === "SENT"
          ? Prisma.sql`j.origin='MANUAL' AND COALESCE(j."groupStatus",j.status)::text IN ('SENT','FAILED','UNCERTAIN','SUPPRESSED','CANCELLED')`
          : input.view === "ALL"
            ? Prisma.sql`TRUE`
            : Prisma.sql`FALSE`;
    const like = input.q
      ? `%${input.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
      : null;
    const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
   WITH mail AS (
    SELECT 'RECEIVED'::text AS kind,m.id,m."messageId",m.subject,m."fromEmail",m."fromName",m."to",m.cc,ARRAY[]::text[] AS bcc,m."receivedAt" AS at,NULL::timestamp AS "scheduledAt",
     COALESCE(m.text,regexp_replace(regexp_replace(COALESCE(m.html,''),'<(script|style)[^>]*>.*?</(script|style)>',' ','gis'),'<[^>]+>',' ','g')) AS body,a.email AS "mailboxEmail",m."inboxAccountId",NULL::text AS "smtpConnectionId",NULL::text AS status,
     (m."readAt" IS NOT NULL) AS read,
     CASE WHEN ${currentFolder("DRAFTS")} THEN 'Mailbox draft' WHEN ${currentFolder("SENT")} THEN 'Mailbox Sent' ELSE 'Received' END AS label,
     1 AS priority
    FROM "InboundMessage" m JOIN "InboxAccount" a ON a.id=m."inboxAccountId"
    WHERE m."organizationId"=${organizationId} AND ${receivedScope} AND ${incomingView}
    UNION ALL
    SELECT 'SENT'::text,j.id,j."messageId",j.subject,COALESCE(s."fromEmail",''),s."fromName",
     CASE WHEN cardinality(j."visibleTo")>0 THEN j."visibleTo" ELSE string_to_array(j."toEmail",',') END,
     CASE WHEN cardinality(j."visibleCc")>0 THEN j."visibleCc" ELSE j.cc END,
     CASE WHEN cardinality(j."visibleBcc")>0 THEN j."visibleBcc" ELSE j.bcc END,
     j."createdAt",j."scheduledAt",COALESCE(j.text,regexp_replace(regexp_replace(COALESCE(j.html,''),'<(script|style)[^>]*>.*?</(script|style)>',' ','gis'),'<[^>]+>',' ','g')),COALESCE(s."fromEmail",''),NULL::text,j."smtpConnectionId",COALESCE(j."groupStatus",j.status)::text,TRUE,
     CASE WHEN COALESCE(j."groupStatus",j.status)::text IN ('PENDING','QUEUED','PROCESSING') THEN 'Outbox' ELSE 'Sent' END,
     0
    FROM "EmailJob" j LEFT JOIN "SMTPConnection" s ON s.id=j."smtpConnectionId"
    WHERE j."organizationId"=${organizationId} AND j.origin!='SYSTEM' AND j."groupPrimary" AND ${sentScope} AND ${outgoingView}
    UNION ALL
    SELECT 'DRAFT'::text,d.id,NULL::text,d.subject,COALESCE(s."fromEmail",''),s."fromName",d."to",d.cc,d.bcc,d."updatedAt",NULL::timestamp,COALESCE(d.text,regexp_replace(regexp_replace(COALESCE(d.html,''),'<(script|style)[^>]*>.*?</(script|style)>',' ','gis'),'<[^>]+>',' ','g')),COALESCE(s."fromEmail",''),NULL::text,d."smtpConnectionId",NULL::text,TRUE,'Personal draft',0
    FROM "EmailDraft" d LEFT JOIN "SMTPConnection" s ON s.id=d."smtpConnectionId"
    WHERE ${input.view === "DRAFTS"} AND d."organizationId"=${organizationId} AND d."createdByUserId"=${userId} AND d."deletedAt" IS NULL AND d."completedSendId" IS NULL
   ), matched AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY lower("mailboxEmail"),COALESCE(NULLIF("messageId",''),kind||':'||id) ORDER BY priority,kind,id) AS duplicate
    FROM mail WHERE ${input.mailbox ? Prisma.sql`lower("mailboxEmail")=${input.mailbox.toLowerCase()}` : Prisma.sql`TRUE`}
     AND ${like ? Prisma.sql`(subject ILIKE ${like} OR "fromEmail" ILIKE ${like} OR "fromName" ILIKE ${like} OR array_to_string("to",',') ILIKE ${like} OR array_to_string(cc,',') ILIKE ${like} OR array_to_string(bcc,',') ILIKE ${like} OR body ILIKE ${like})` : Prisma.sql`TRUE`}
   )
   SELECT kind,id,"messageId",subject,"fromEmail","fromName",("to")[1:10] AS "to",(cc)[1:10] AS cc,at,"scheduledAt",LEFT(body,400) AS preview,"mailboxEmail","inboxAccountId","smtpConnectionId",status,read,label
   FROM matched WHERE duplicate=1 AND ${cursor ? Prisma.sql`(at,kind,id)<(${cursor.at},${cursor.kind},${cursor.id})` : Prisma.sql`TRUE`}
   ORDER BY at DESC,kind DESC,id DESC LIMIT ${input.limit + 1}
  `);
    const hasMore = rows.length > input.limit;
    const shown = rows.slice(0, input.limit);
    const last = shown.at(-1);
    return {
      rows: shown.map((row) => ({
        ...row,
        at: row.at.toISOString(),
        scheduledAt: row.scheduledAt?.toISOString() ?? null,
      })),
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({
                at: last.at.toISOString(),
                id: last.id,
                kind: last.kind,
                scope: fingerprint(input, organizationId, userId),
              })
            ).toString("base64url")
          : null,
    };
  },
};
