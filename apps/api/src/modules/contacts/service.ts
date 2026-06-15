import type { InputJsonValue } from "@prisma/client/runtime/library";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  emailAddressSchema,
  type ContactInput,
  type SegmentFilterInput
} from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { buildSegmentWhere } from "./segment.js";

export interface ParsedContactRow {
  email: string;
  firstName?: string;
  lastName?: string;
  tags: string[];
}

export interface CsvParseError {
  /** 1-based source line (accounts for the header row). */
  row: number;
  message: string;
}

export interface ContactImportSummary {
  created: number;
  updated: number;
  skipped: number;
  suppressed: number;
  errors: CsvParseError[];
}

// Collapse header variants ("First Name", "first_name") to a canonical key.
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_]+/g, "");
}

/**
 * Parse a contacts CSV into validated rows plus per-row errors. Pure (no DB) so
 * it is unit-testable in isolation. Recognized headers (case/space/underscore
 * insensitive): email (required), firstName, lastName, tags (comma- or
 * semicolon-separated within the cell).
 */
export function parseContactsCsv(csv: string): {
  rows: ParsedContactRow[];
  errors: CsvParseError[];
} {
  let records: Record<string, string>[];
  try {
    records = parse(csv, {
      columns: (header: string[]) => header.map(normalizeHeader),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true
    }) as Record<string, string>[];
  } catch {
    return { rows: [], errors: [{ row: 0, message: "Could not parse CSV" }] };
  }

  const rows: ParsedContactRow[] = [];
  const errors: CsvParseError[] = [];

  records.forEach((record, index) => {
    const sourceRow = index + 2; // +1 for 0-based, +1 for the header row.
    const email = (record.email ?? "").trim();

    if (!email) {
      errors.push({ row: sourceRow, message: "Missing email" });
      return;
    }
    if (!emailAddressSchema.safeParse(email).success) {
      errors.push({ row: sourceRow, message: `Invalid email: ${email}` });
      return;
    }

    const tags = Array.from(
      new Set(
        (record.tags ?? "")
          .split(/[,;]/)
          .map((tag) => tag.trim())
          .filter(Boolean)
      )
    );

    rows.push({
      email,
      firstName: record.firstname?.trim() || undefined,
      lastName: record.lastname?.trim() || undefined,
      tags
    });
  });

  return { rows, errors };
}

export const contactService = {
  list(organizationId: string) {
    return prisma.contact.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" }
    });
  },

  // Scoped by membership: only resolves contacts in an org the user belongs to.
  get(id: string, userId: string) {
    return prisma.contact.findFirst({
      where: { id, organization: { members: { some: { userId } } } }
    });
  },

  create(input: ContactInput) {
    return prisma.contact.create({
      data: {
        ...input,
        metadata: input.metadata as InputJsonValue | undefined
      }
    });
  },

  async update(id: string, userId: string, input: ContactInput) {
    const existing = await prisma.contact.findFirst({
      where: { id, organization: { members: { some: { userId } } } },
      select: { id: true }
    });
    if (!existing) {
      throw new HttpError(404, "Contact not found");
    }

    return prisma.contact.update({
      where: { id },
      data: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        tags: input.tags,
        metadata: input.metadata as InputJsonValue | undefined
      }
    });
  },

  async delete(id: string, userId: string) {
    const { count } = await prisma.contact.deleteMany({
      where: { id, organization: { members: { some: { userId } } } }
    });
    if (count === 0) {
      throw new HttpError(404, "Contact not found");
    }
  },

  /**
   * Bulk import contacts from CSV. Upserts by (organizationId, email): new
   * contacts are created, existing ones have names filled in and tags merged
   * (union, never clobbered). Addresses already on the suppression list are
   * still imported but reported separately and never reactivated. When a target
   * list is given, members are linked with source CSV_IMPORT.
   */
  async importContacts(params: {
    organizationId: string;
    csv: string;
    contactListId?: string;
  }): Promise<ContactImportSummary> {
    const { organizationId, csv, contactListId } = params;
    const { rows, errors } = parseContactsCsv(csv);

    if (contactListId) {
      const list = await prisma.contactList.findFirst({
        where: { id: contactListId, organizationId },
        select: { id: true }
      });
      if (!list) {
        throw new HttpError(404, "Contact list not found");
      }
    }

    const emails = rows.map((row) => row.email);
    const suppressedRows =
      emails.length > 0
        ? await prisma.suppression.findMany({
            where: { organizationId, email: { in: emails } },
            select: { email: true }
          })
        : [];
    const suppressedEmails = new Set(suppressedRows.map((row) => row.email));

    let created = 0;
    let updated = 0;
    let suppressed = 0;

    for (const row of rows) {
      const existing = await prisma.contact.findUnique({
        where: { organizationId_email: { organizationId, email: row.email } },
        select: { id: true, tags: true, firstName: true, lastName: true }
      });

      let contactId: string;
      if (existing) {
        // Merge tags (union) and only fill in names that the import provides;
        // never overwrite existing data with blanks. Status is left untouched so
        // an import never reactivates a bounced/unsubscribed contact.
        const mergedTags = Array.from(new Set([...existing.tags, ...row.tags]));
        const contact = await prisma.contact.update({
          where: { id: existing.id },
          data: {
            firstName: row.firstName ?? existing.firstName,
            lastName: row.lastName ?? existing.lastName,
            tags: mergedTags
          }
        });
        contactId = contact.id;
        updated += 1;
      } else {
        const contact = await prisma.contact.create({
          data: {
            organizationId,
            email: row.email,
            firstName: row.firstName,
            lastName: row.lastName,
            tags: row.tags
          }
        });
        contactId = contact.id;
        created += 1;
      }

      if (suppressedEmails.has(row.email)) {
        suppressed += 1;
      }

      if (contactListId) {
        await prisma.contactListMember.upsert({
          where: { contactListId_contactId: { contactListId, contactId } },
          create: { contactListId, contactId, source: "CSV_IMPORT" },
          update: {}
        });
      }
    }

    return { created, updated, skipped: errors.length, suppressed, errors };
  },

  /**
   * Per-contact activity timeline. EmailJob has no contact FK, so events are
   * correlated by the recipient address (organizationId + toEmail = email) and
   * returned newest-first, cursor-paginated on event id. CC/BCC recipients are
   * not matched (the contact must be the primary `To`).
   */
  async activity(
    id: string,
    userId: string,
    options: { cursor?: string; limit: number }
  ) {
    const contact = await prisma.contact.findFirst({
      where: { id, organization: { members: { some: { userId } } } },
      select: { id: true, organizationId: true, email: true }
    });
    if (!contact) {
      throw new HttpError(404, "Contact not found");
    }

    const jobs = await prisma.emailJob.findMany({
      where: { organizationId: contact.organizationId, toEmail: contact.email },
      select: {
        id: true,
        subject: true,
        origin: true,
        campaign: { select: { name: true } }
      }
    });

    if (jobs.length === 0) {
      return { events: [], nextCursor: null };
    }

    const jobsById = new Map(jobs.map((job) => [job.id, job]));

    const events = await prisma.emailEvent.findMany({
      where: { emailJobId: { in: [...jobsById.keys()] } },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: options.limit + 1,
      ...(options.cursor
        ? { cursor: { id: options.cursor }, skip: 1 }
        : {})
    });

    const hasMore = events.length > options.limit;
    const page = hasMore ? events.slice(0, options.limit) : events;

    return {
      events: page.map((event) => {
        const job = jobsById.get(event.emailJobId);
        const metadata = (event.metadata ?? {}) as Record<string, unknown>;
        return {
          id: event.id,
          type: event.type,
          occurredAt: event.occurredAt,
          emailJobId: event.emailJobId,
          subject: job?.subject ?? null,
          origin: job?.origin ?? null,
          campaignName: job?.campaign?.name ?? null,
          url: typeof metadata.url === "string" ? metadata.url : undefined
        };
      }),
      nextCursor: hasMore ? page[page.length - 1].id : null
    };
  },

  /** Count + sample of contacts matching a tag-driven segment filter. */
  async previewSegment(input: SegmentFilterInput) {
    const where = buildSegmentWhere(input);
    const [count, sample] = await Promise.all([
      prisma.contact.count({ where }),
      prisma.contact.findMany({ where, take: 10, orderBy: { createdAt: "desc" } })
    ]);
    return { count, sample };
  },

  /** Serialize contacts (optionally a single list's members) to CSV text. */
  async exportContacts(organizationId: string, contactListId?: string) {
    const contacts = contactListId
      ? (
          await prisma.contactListMember.findMany({
            where: { contactListId, contactList: { organizationId } },
            include: { contact: true },
            orderBy: { addedAt: "asc" }
          })
        ).map((member) => member.contact)
      : await prisma.contact.findMany({
          where: { organizationId },
          orderBy: { createdAt: "asc" }
        });

    return stringify(
      contacts.map((contact) => ({
        email: contact.email,
        firstName: contact.firstName ?? "",
        lastName: contact.lastName ?? "",
        status: contact.status,
        tags: contact.tags.join(", "),
        createdAt: contact.createdAt.toISOString()
      })),
      {
        header: true,
        columns: ["email", "firstName", "lastName", "status", "tags", "createdAt"]
      }
    );
  }
};
