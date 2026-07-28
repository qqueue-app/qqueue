import type { InputJsonValue } from "@prisma/client/runtime/library";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  emailAddressSchema,
  type ContactImportOverride,
  type ContactImportResolution,
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
  /** Duplicates that were merged or replaced. */
  updated: number;
  /** Duplicates left as they were (KEEP or SKIP). */
  unchanged: number;
  /** Rows that could not be read — always equal to `errors.length`. */
  skipped: number;
  suppressed: number;
  errors: CsvParseError[];
  /** The list rows were linked into, when the import targeted one. */
  contactList?: { id: string; name: string; created: boolean };
}

export type ContactImportChangedField = "firstName" | "lastName" | "tags";

/** A CSV row whose email already belongs to a contact in the organization. */
export interface ContactImportDuplicate {
  email: string;
  incoming: { firstName?: string; lastName?: string; tags: string[] };
  existing: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    tags: string[];
    status: string;
  };
  /** The address is on the org's suppression list. */
  suppressed: boolean;
  /** Fields whose value would actually differ after a REPLACE. */
  changedFields: ContactImportChangedField[];
}

export interface ContactImportPreview {
  /** Distinct contacts the file resolves to, after in-file collapsing. */
  totalRows: number;
  newCount: number;
  duplicateCount: number;
  suppressedCount: number;
  /** Rows dropped because the same email appeared earlier in the file. */
  collapsedInFile: number;
  errors: CsvParseError[];
  duplicates: ContactImportDuplicate[];
  /** True when `duplicates` was capped — the rest still import under the default. */
  duplicatesTruncated: boolean;
  newSample: ParsedContactRow[];
  /** Resolved target list. `id` is null when the list would be created. */
  contactList?: { id: string | null; name: string; willCreate: boolean };
}

// The review screen renders one row per duplicate, so the list is capped rather
// than shipping an unbounded payload. Duplicates past the cap are not hidden:
// they still import under the chosen default and the UI says how many.
const DUPLICATE_PREVIEW_LIMIT = 500;
const NEW_SAMPLE_LIMIT = 20;

const DEFAULT_RESOLUTION: ContactImportResolution = "MERGE";

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

/**
 * Collapse rows that repeat the same address within one file into a single
 * contact: later rows fill in names they supply and their tags accumulate.
 *
 * Without this the same person listed twice was counted twice (once created,
 * once "updated"), so the summary reported rows rather than people, and the
 * review screen would show a contact as both new and duplicate. Matching is
 * case-insensitive on the whole address, which is how mail providers treat it in
 * practice.
 */
export function collapseDuplicateRows(rows: ParsedContactRow[]): {
  rows: ParsedContactRow[];
  collapsed: number;
} {
  const byEmail = new Map<string, ParsedContactRow>();
  let collapsed = 0;

  for (const row of rows) {
    const key = row.email.toLowerCase();
    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, { ...row, tags: [...row.tags] });
      continue;
    }
    collapsed += 1;
    existing.firstName = row.firstName ?? existing.firstName;
    existing.lastName = row.lastName ?? existing.lastName;
    existing.tags = Array.from(new Set([...existing.tags, ...row.tags]));
  }

  return { rows: [...byEmail.values()], collapsed };
}

/** Apply the review screen's inline edits to a parsed row. */
function applyOverride(
  row: ParsedContactRow,
  override: ContactImportOverride | undefined
): ParsedContactRow {
  if (!override) {
    return row;
  }
  return {
    email: row.email,
    // An override that blanks a name is a deliberate clear, so "" is honoured as
    // undefined rather than falling back to the CSV value.
    firstName:
      override.firstName === undefined
        ? row.firstName
        : override.firstName.trim() || undefined,
    lastName:
      override.lastName === undefined
        ? row.lastName
        : override.lastName.trim() || undefined,
    tags: override.tags ?? row.tags
  };
}

/**
 * Existing contacts and suppressions for a set of addresses, in two queries
 * rather than one lookup per row. Keyed lower-cased so callers can match a CSV
 * row regardless of how the address was capitalized.
 */
async function loadExistingByEmail(organizationId: string, emails: string[]) {
  if (emails.length === 0) {
    return {
      contacts: new Map<string, ExistingContact>(),
      suppressed: new Set<string>()
    };
  }

  const [contacts, suppressions] = await Promise.all([
    prisma.contact.findMany({
      where: { organizationId, email: { in: emails } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        tags: true,
        status: true
      }
    }),
    prisma.suppression.findMany({
      where: { organizationId, email: { in: emails } },
      select: { email: true }
    })
  ]);

  return {
    contacts: new Map(
      contacts.map((contact) => [contact.email.toLowerCase(), contact])
    ),
    suppressed: new Set(suppressions.map((row) => row.email.toLowerCase()))
  };
}

interface ExistingContact {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  tags: string[];
  status: string;
}

/** Fields a REPLACE would actually change, for the review screen's diff. */
function diffFields(
  row: ParsedContactRow,
  existing: ExistingContact
): ContactImportChangedField[] {
  const changed: ContactImportChangedField[] = [];
  if ((row.firstName ?? null) !== existing.firstName) {
    changed.push("firstName");
  }
  if ((row.lastName ?? null) !== existing.lastName) {
    changed.push("lastName");
  }
  const incomingTags = [...row.tags].sort().join(" ");
  const existingTags = [...existing.tags].sort().join(" ");
  if (incomingTags !== existingTags) {
    changed.push("tags");
  }
  return changed;
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
   * Delete many contacts at once. Ids that don't belong to the caller's
   * organization are filtered out by the same membership scoping the single
   * delete uses, so a mismatched id is skipped rather than leaking existence.
   * Returns the number actually removed so the UI can report a partial result.
   *
   * List memberships cascade (ContactListMember.contact is onDelete: Cascade),
   * and campaigns reference lists rather than contacts, so nothing else needs
   * cleaning up here. Suppressions are keyed by email and deliberately survive:
   * deleting a contact must not silently un-suppress that address.
   */
  async bulkDelete(
    organizationId: string,
    userId: string,
    contactIds: string[]
  ): Promise<{ deleted: number }> {
    const { count } = await prisma.contact.deleteMany({
      where: {
        id: { in: contactIds },
        organizationId,
        organization: { members: { some: { userId } } }
      }
    });
    return { deleted: count };
  },

  /**
   * Dry-run an import: parse the CSV, classify every row against what is already
   * in the organization, and write nothing.
   *
   * This exists so a duplicate is a decision rather than a silent merge. The
   * import used to overwrite names and union tags with no way to see which
   * contacts were touched or what changed; the review screen this feeds shows
   * the before/after for each collision before anything is committed.
   */
  async previewImport(params: {
    organizationId: string;
    csv: string;
    contactListId?: string;
    contactListName?: string;
  }): Promise<ContactImportPreview> {
    const { organizationId, csv, contactListId, contactListName } = params;
    const parsed = parseContactsCsv(csv);
    const { rows, collapsed } = collapseDuplicateRows(parsed.rows);

    let listPreview: ContactImportPreview["contactList"];
    if (contactListId) {
      const list = await prisma.contactList.findFirst({
        where: { id: contactListId, organizationId },
        select: { id: true, name: true }
      });
      if (!list) {
        throw new HttpError(404, "Contact list not found");
      }
      listPreview = { id: list.id, name: list.name, willCreate: false };
    } else if (contactListName?.trim()) {
      const trimmed = contactListName.trim();
      const existingList = await prisma.contactList.findFirst({
        where: { organizationId, name: trimmed },
        select: { id: true, name: true }
      });
      listPreview = {
        id: existingList?.id ?? null,
        name: trimmed,
        willCreate: !existingList
      };
    }

    const { contacts, suppressed } = await loadExistingByEmail(
      organizationId,
      rows.map((row) => row.email)
    );

    const duplicates: ContactImportDuplicate[] = [];
    const newSample: ParsedContactRow[] = [];
    let newCount = 0;
    let suppressedCount = 0;

    for (const row of rows) {
      const key = row.email.toLowerCase();
      if (suppressed.has(key)) {
        suppressedCount += 1;
      }

      const existing = contacts.get(key);
      if (!existing) {
        newCount += 1;
        if (newSample.length < NEW_SAMPLE_LIMIT) {
          newSample.push(row);
        }
        continue;
      }

      if (duplicates.length < DUPLICATE_PREVIEW_LIMIT) {
        duplicates.push({
          email: row.email,
          incoming: {
            firstName: row.firstName,
            lastName: row.lastName,
            tags: row.tags
          },
          existing: {
            id: existing.id,
            firstName: existing.firstName,
            lastName: existing.lastName,
            tags: existing.tags,
            status: existing.status
          },
          suppressed: suppressed.has(key),
          changedFields: diffFields(row, existing)
        });
      }
    }

    const duplicateCount = rows.length - newCount;

    return {
      totalRows: rows.length,
      newCount,
      duplicateCount,
      suppressedCount,
      collapsedInFile: collapsed,
      errors: parsed.errors,
      duplicates,
      duplicatesTruncated: duplicateCount > duplicates.length,
      newSample,
      ...(listPreview ? { contactList: listPreview } : {})
    };
  },

  /**
   * Bulk import contacts from CSV. Rows with no existing contact are always
   * created; rows whose email already exists are resolved by `defaultResolution`
   * (MERGE unless the caller says otherwise), with `overrides` supplying per-email
   * decisions and inline edits from the review screen.
   *
   * No resolution touches `status`, so an import can never reactivate a bounced
   * or unsubscribed contact. Addresses on the suppression list are still
   * imported but reported separately.
   *
   * The target list may be an existing id (`contactListId`) or a name to create
   * (`contactListName`). Importing straight into a list is the normal path: the
   * contact record itself still dedupes org-wide on email, so the same person
   * imported into three lists is one Contact with three memberships.
   */
  async importContacts(params: {
    organizationId: string;
    csv: string;
    contactListId?: string;
    contactListName?: string;
    defaultResolution?: ContactImportResolution;
    overrides?: Record<string, ContactImportOverride>;
  }): Promise<ContactImportSummary> {
    const { organizationId, csv, contactListName, overrides } = params;
    const defaultResolution = params.defaultResolution ?? DEFAULT_RESOLUTION;
    let { contactListId } = params;
    const parsed = parseContactsCsv(csv);
    const { rows } = collapseDuplicateRows(parsed.rows);
    const errors = parsed.errors;
    let listSummary: ContactImportSummary["contactList"];

    if (contactListId) {
      const list = await prisma.contactList.findFirst({
        where: { id: contactListId, organizationId },
        select: { id: true, name: true }
      });
      if (!list) {
        throw new HttpError(404, "Contact list not found");
      }
      listSummary = { id: list.id, name: list.name, created: false };
    } else if (contactListName) {
      // Reuse a same-named list rather than creating duplicates on re-import;
      // ContactList has no unique constraint on (organizationId, name), so this
      // is a find-then-create by design.
      const trimmed = contactListName.trim();
      if (!trimmed) {
        throw new HttpError(400, "Contact list name is required", "validation_error");
      }
      const existingList = await prisma.contactList.findFirst({
        where: { organizationId, name: trimmed },
        select: { id: true, name: true }
      });
      const list =
        existingList ??
        (await prisma.contactList.create({
          data: { organizationId, name: trimmed },
          select: { id: true, name: true }
        }));
      contactListId = list.id;
      listSummary = { id: list.id, name: list.name, created: !existingList };
    }

    const { contacts, suppressed } = await loadExistingByEmail(
      organizationId,
      rows.map((row) => row.email)
    );

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let suppressedCount = 0;
    const memberContactIds: string[] = [];

    for (const parsedRow of rows) {
      const key = parsedRow.email.toLowerCase();
      const override = overrides?.[key];
      const row = applyOverride(parsedRow, override);
      const existing = contacts.get(key);

      if (!existing) {
        const contact = await prisma.contact.create({
          data: {
            organizationId,
            email: row.email,
            firstName: row.firstName,
            lastName: row.lastName,
            tags: row.tags
          }
        });
        created += 1;
        memberContactIds.push(contact.id);
        if (suppressed.has(key)) {
          suppressedCount += 1;
        }
        continue;
      }

      const resolution = override?.resolution ?? defaultResolution;

      // SKIP is the only resolution that removes the row from the import
      // outright — KEEP still links the existing contact into the target list,
      // it just doesn't rewrite the contact itself.
      if (resolution === "SKIP") {
        unchanged += 1;
        continue;
      }

      if (resolution === "KEEP") {
        unchanged += 1;
      } else if (resolution === "REPLACE") {
        await prisma.contact.update({
          where: { id: existing.id },
          data: {
            firstName: row.firstName ?? null,
            lastName: row.lastName ?? null,
            tags: row.tags
          }
        });
        updated += 1;
      } else {
        // MERGE: fill in only the names the import provides and union the tags,
        // so a CSV missing a column can never blank out existing data.
        await prisma.contact.update({
          where: { id: existing.id },
          data: {
            firstName: row.firstName ?? existing.firstName,
            lastName: row.lastName ?? existing.lastName,
            tags: Array.from(new Set([...existing.tags, ...row.tags]))
          }
        });
        updated += 1;
      }

      if (suppressed.has(key)) {
        suppressedCount += 1;
      }
      memberContactIds.push(existing.id);
    }

    if (contactListId && memberContactIds.length > 0) {
      // skipDuplicates covers contacts already on the list: re-importing is a
      // no-op on the membership rather than an error.
      await prisma.contactListMember.createMany({
        data: memberContactIds.map((contactId) => ({
          contactListId: contactListId!,
          contactId,
          source: "CSV_IMPORT" as const
        })),
        skipDuplicates: true
      });
    }

    return {
      created,
      updated,
      unchanged,
      skipped: errors.length,
      suppressed: suppressedCount,
      errors,
      ...(listSummary ? { contactList: listSummary } : {})
    };
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
