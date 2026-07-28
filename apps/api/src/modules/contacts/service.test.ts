import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";
import {
  collapseDuplicateRows,
  contactService,
  parseContactsCsv
} from "./service.js";

const input = {
  organizationId: "org_1",
  email: "a@b.com",
  firstName: "A",
  lastName: "B",
  tags: ["vip", "newsletter"],
  metadata: { tier: "gold" }
};

describe("contactService", () => {
  it("lists contacts for an organization", () => {
    prismaMock.contact.findMany.mockResolvedValue([] as never);
    contactService.list("org_1");
    expect(prismaMock.contact.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      orderBy: { createdAt: "desc" }
    });
  });

  it("gets a contact scoped by membership", () => {
    prismaMock.contact.findFirst.mockResolvedValue({ id: "c1" } as never);
    contactService.get("c1", "user_1");
    expect(prismaMock.contact.findFirst).toHaveBeenCalled();
  });

  it("creates a contact with tags", () => {
    prismaMock.contact.create.mockResolvedValue({ id: "c1" } as never);
    contactService.create(input);
    const call = prismaMock.contact.create.mock.calls[0][0];
    expect(call.data.tags).toEqual(["vip", "newsletter"]);
  });

  it("updates an owned contact and persists tags", async () => {
    prismaMock.contact.findFirst.mockResolvedValue({ id: "c1" } as never);
    prismaMock.contact.update.mockResolvedValue({ id: "c1" } as never);
    await contactService.update("c1", "user_1", input);
    const call = prismaMock.contact.update.mock.calls[0][0];
    expect(call.data.tags).toEqual(["vip", "newsletter"]);
  });

  it("throws 404 updating a contact the user does not own", async () => {
    prismaMock.contact.findFirst.mockResolvedValue(null);
    await expect(contactService.update("c1", "user_1", input)).rejects.toThrow(
      HttpError
    );
  });

  it("deletes an owned contact", async () => {
    prismaMock.contact.deleteMany.mockResolvedValue({ count: 1 } as never);
    await contactService.delete("c1", "user_1");
    expect(prismaMock.contact.deleteMany).toHaveBeenCalled();
  });

  it("throws 404 deleting a contact that does not exist", async () => {
    prismaMock.contact.deleteMany.mockResolvedValue({ count: 0 } as never);
    await expect(contactService.delete("c1", "user_1")).rejects.toThrow(
      "Contact not found"
    );
  });
});

describe("parseContactsCsv", () => {
  it("parses rows, normalizes headers and splits tags", () => {
    const csv =
      "Email,First Name,Last_Name,Tags\n" +
      "a@b.com,Ann,Bee,vip; newsletter\n" +
      "c@d.com,,,\n";
    const { rows, errors } = parseContactsCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { email: "a@b.com", firstName: "Ann", lastName: "Bee", tags: ["vip", "newsletter"] },
      { email: "c@d.com", firstName: undefined, lastName: undefined, tags: [] }
    ]);
  });

  it("reports invalid and missing emails with source line numbers", () => {
    const csv = "email,firstName\nnot-an-email,X\n,Y\nok@x.com,Z\n";
    const { rows, errors } = parseContactsCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("ok@x.com");
    expect(errors).toEqual([
      { row: 2, message: "Invalid email: not-an-email" },
      { row: 3, message: "Missing email" }
    ]);
  });

  it("dedupes tags within a cell", () => {
    const { rows } = parseContactsCsv('email,tags\na@b.com,"vip,vip,gold"\n');
    expect(rows[0].tags).toEqual(["vip", "gold"]);
  });
});

describe("collapseDuplicateRows", () => {
  it("folds repeats of the same address into one contact", () => {
    const { rows, collapsed } = collapseDuplicateRows([
      { email: "a@b.com", firstName: "Ann", tags: ["vip"] },
      { email: "A@B.com", lastName: "Bee", tags: ["gold"] },
      { email: "c@d.com", tags: [] }
    ]);

    expect(collapsed).toBe(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      email: "a@b.com",
      firstName: "Ann",
      lastName: "Bee",
      tags: ["vip", "gold"]
    });
  });

  it("lets a later row fill a name the first one left blank", () => {
    const { rows } = collapseDuplicateRows([
      { email: "a@b.com", firstName: "Ann", tags: [] },
      { email: "a@b.com", firstName: "Anna", tags: [] }
    ]);

    expect(rows[0].firstName).toBe("Anna");
  });
});

describe("contactService.previewImport", () => {
  it("classifies rows against existing contacts without writing anything", async () => {
    prismaMock.contact.findMany.mockResolvedValue([
      {
        id: "existing",
        email: "a@b.com",
        firstName: "Keep",
        lastName: null,
        tags: ["old"],
        status: "ACTIVE"
      }
    ] as never);
    prismaMock.suppression.findMany.mockResolvedValue([] as never);

    const preview = await contactService.previewImport({
      organizationId: "org_1",
      csv: "email,firstName,tags\na@b.com,,new\nc@d.com,Cara,gold\n"
    });

    expect(preview).toMatchObject({
      totalRows: 2,
      newCount: 1,
      duplicateCount: 1,
      duplicatesTruncated: false
    });
    expect(preview.duplicates[0]).toMatchObject({
      email: "a@b.com",
      existing: { id: "existing", tags: ["old"] },
      changedFields: ["firstName", "tags"]
    });
    expect(preview.newSample[0].email).toBe("c@d.com");
    expect(prismaMock.contact.create).not.toHaveBeenCalled();
    expect(prismaMock.contact.update).not.toHaveBeenCalled();
  });

  it("reports a named list it would create without creating it", async () => {
    prismaMock.contact.findMany.mockResolvedValue([] as never);
    prismaMock.suppression.findMany.mockResolvedValue([] as never);
    prismaMock.contactList.findFirst.mockResolvedValue(null as never);

    const preview = await contactService.previewImport({
      organizationId: "org_1",
      contactListName: "Newsletter",
      csv: "email\na@b.com\n"
    });

    expect(preview.contactList).toEqual({
      id: null,
      name: "Newsletter",
      willCreate: true
    });
    expect(prismaMock.contactList.create).not.toHaveBeenCalled();
  });

  it("counts in-file repeats and parse errors separately", async () => {
    prismaMock.contact.findMany.mockResolvedValue([] as never);
    prismaMock.suppression.findMany.mockResolvedValue([] as never);

    const preview = await contactService.previewImport({
      organizationId: "org_1",
      csv: "email\na@b.com\na@b.com\nbad-email\n"
    });

    expect(preview.totalRows).toBe(1);
    expect(preview.collapsedInFile).toBe(1);
    expect(preview.errors).toHaveLength(1);
  });
});

describe("contactService.importContacts", () => {
  // Existing contacts and suppressions are loaded in one bulk query each rather
  // than a lookup per row, so both mocks are keyed by the whole address set.
  function mockExisting(
    contacts: unknown[] = [],
    suppressions: unknown[] = []
  ) {
    prismaMock.contact.findMany.mockResolvedValue(contacts as never);
    prismaMock.suppression.findMany.mockResolvedValue(suppressions as never);
  }

  it("creates new contacts, merges tags on existing, and links list membership", async () => {
    mockExisting([
      {
        id: "existing",
        email: "a@b.com",
        firstName: "Keep",
        lastName: null,
        tags: ["old"],
        status: "ACTIVE"
      }
    ]);
    prismaMock.contactList.findFirst.mockResolvedValue({ id: "list_1" } as never);
    prismaMock.contact.update.mockResolvedValue({ id: "existing" } as never);
    prismaMock.contact.create.mockResolvedValue({ id: "new" } as never);
    prismaMock.contactListMember.createMany.mockResolvedValue({
      count: 2
    } as never);

    const summary = await contactService.importContacts({
      organizationId: "org_1",
      contactListId: "list_1",
      csv: "email,firstName,tags\na@b.com,,new\nc@d.com,Cara,gold\n"
    });

    expect(summary).toMatchObject({
      created: 1,
      updated: 1,
      unchanged: 0,
      skipped: 0,
      suppressed: 0
    });
    // Existing contact keeps its name and gets the union of tags.
    expect(prismaMock.contact.update.mock.calls[0][0].data).toMatchObject({
      firstName: "Keep",
      tags: ["old", "new"]
    });
    // Both contacts linked with the CSV_IMPORT source.
    expect(
      prismaMock.contactListMember.createMany.mock.calls[0][0].data
    ).toEqual([
      { contactListId: "list_1", contactId: "existing", source: "CSV_IMPORT" },
      { contactListId: "list_1", contactId: "new", source: "CSV_IMPORT" }
    ]);
  });

  it("overwrites names and tags under REPLACE", async () => {
    mockExisting([
      {
        id: "existing",
        email: "a@b.com",
        firstName: "Old",
        lastName: "Name",
        tags: ["old"],
        status: "ACTIVE"
      }
    ]);
    prismaMock.contact.update.mockResolvedValue({ id: "existing" } as never);

    const summary = await contactService.importContacts({
      organizationId: "org_1",
      defaultResolution: "REPLACE",
      csv: "email,firstName,tags\na@b.com,New,fresh\n"
    });

    expect(summary).toMatchObject({ created: 0, updated: 1, unchanged: 0 });
    expect(prismaMock.contact.update.mock.calls[0][0].data).toMatchObject({
      firstName: "New",
      // A column the CSV didn't carry is cleared, unlike MERGE.
      lastName: null,
      tags: ["fresh"]
    });
  });

  it("leaves the contact alone under KEEP but still links the list", async () => {
    mockExisting([
      {
        id: "existing",
        email: "a@b.com",
        firstName: "Old",
        lastName: null,
        tags: ["old"],
        status: "ACTIVE"
      }
    ]);
    prismaMock.contactList.findFirst.mockResolvedValue({ id: "list_1" } as never);
    prismaMock.contactListMember.createMany.mockResolvedValue({
      count: 1
    } as never);

    const summary = await contactService.importContacts({
      organizationId: "org_1",
      contactListId: "list_1",
      defaultResolution: "KEEP",
      csv: "email,firstName\na@b.com,New\n"
    });

    expect(summary).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(prismaMock.contact.update).not.toHaveBeenCalled();
    expect(
      prismaMock.contactListMember.createMany.mock.calls[0][0].data
    ).toEqual([
      { contactListId: "list_1", contactId: "existing", source: "CSV_IMPORT" }
    ]);
  });

  it("drops the row entirely under SKIP, list membership included", async () => {
    mockExisting([
      {
        id: "existing",
        email: "a@b.com",
        firstName: "Old",
        lastName: null,
        tags: [],
        status: "ACTIVE"
      }
    ]);
    prismaMock.contactList.findFirst.mockResolvedValue({ id: "list_1" } as never);

    const summary = await contactService.importContacts({
      organizationId: "org_1",
      contactListId: "list_1",
      defaultResolution: "SKIP",
      csv: "email,firstName\na@b.com,New\n"
    });

    expect(summary).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(prismaMock.contact.update).not.toHaveBeenCalled();
    expect(prismaMock.contactListMember.createMany).not.toHaveBeenCalled();
  });

  it("applies a per-email override ahead of the default resolution", async () => {
    mockExisting([
      {
        id: "keep_me",
        email: "keep@b.com",
        firstName: "Keep",
        lastName: null,
        tags: [],
        status: "ACTIVE"
      },
      {
        id: "replace_me",
        email: "replace@b.com",
        firstName: "Old",
        lastName: null,
        tags: [],
        status: "ACTIVE"
      }
    ]);
    prismaMock.contact.update.mockResolvedValue({ id: "replace_me" } as never);

    const summary = await contactService.importContacts({
      organizationId: "org_1",
      defaultResolution: "REPLACE",
      overrides: { "keep@b.com": { resolution: "KEEP" } },
      csv: "email,firstName\nkeep@b.com,New\nreplace@b.com,New\n"
    });

    expect(summary).toMatchObject({ updated: 1, unchanged: 1 });
    expect(prismaMock.contact.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.contact.update.mock.calls[0][0].where).toEqual({
      id: "replace_me"
    });
  });

  it("uses inline-edited values instead of what the CSV carried", async () => {
    mockExisting([
      {
        id: "existing",
        email: "a@b.com",
        firstName: "Old",
        lastName: null,
        tags: [],
        status: "ACTIVE"
      }
    ]);
    prismaMock.contact.update.mockResolvedValue({ id: "existing" } as never);

    await contactService.importContacts({
      organizationId: "org_1",
      defaultResolution: "REPLACE",
      overrides: {
        "a@b.com": { firstName: "Corrected", tags: ["edited"] }
      },
      csv: "email,firstName,tags\na@b.com,FromCsv,fromcsv\n"
    });

    expect(prismaMock.contact.update.mock.calls[0][0].data).toMatchObject({
      firstName: "Corrected",
      tags: ["edited"]
    });
  });

  it("never writes status, so an import can't reactivate a bounced contact", async () => {
    mockExisting([
      {
        id: "existing",
        email: "a@b.com",
        firstName: null,
        lastName: null,
        tags: [],
        status: "BOUNCED"
      }
    ]);
    prismaMock.contact.update.mockResolvedValue({ id: "existing" } as never);

    await contactService.importContacts({
      organizationId: "org_1",
      defaultResolution: "REPLACE",
      csv: "email,firstName\na@b.com,Ann\n"
    });

    expect(prismaMock.contact.update.mock.calls[0][0].data).not.toHaveProperty(
      "status"
    );
  });

  it("counts a repeated address in one file as a single contact", async () => {
    mockExisting();
    prismaMock.contact.create.mockResolvedValue({ id: "new" } as never);

    const summary = await contactService.importContacts({
      organizationId: "org_1",
      csv: "email,tags\na@b.com,one\na@b.com,two\n"
    });

    expect(summary).toMatchObject({ created: 1, updated: 0 });
    expect(prismaMock.contact.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.contact.create.mock.calls[0][0].data).toMatchObject({
      tags: ["one", "two"]
    });
  });

  it("counts suppressed addresses and reports parse errors as skipped", async () => {
    mockExisting([], [{ email: "blocked@b.com" }]);
    prismaMock.contact.create.mockResolvedValue({ id: "new" } as never);

    const summary = await contactService.importContacts({
      organizationId: "org_1",
      csv: "email\nblocked@b.com\nbad-email\n"
    });

    expect(summary.created).toBe(1);
    expect(summary.suppressed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.errors[0]).toMatchObject({ row: 3 });
  });

  it("throws 404 when the target list is not in the org", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue(null);
    await expect(
      contactService.importContacts({
        organizationId: "org_1",
        contactListId: "missing",
        csv: "email\na@b.com\n"
      })
    ).rejects.toThrow("Contact list not found");
  });

  it("creates a list by name and reports it as newly created", async () => {
    mockExisting();
    prismaMock.contactList.findFirst.mockResolvedValue(null as never);
    prismaMock.contactList.create.mockResolvedValue({
      id: "list_new",
      name: "Newsletter"
    } as never);
    prismaMock.contact.create.mockResolvedValue({ id: "new" } as never);
    prismaMock.contactListMember.createMany.mockResolvedValue({
      count: 1
    } as never);

    const summary = await contactService.importContacts({
      organizationId: "org_1",
      contactListName: "Newsletter",
      csv: "email\na@b.com\n"
    });

    expect(prismaMock.contactList.create).toHaveBeenCalledWith({
      data: { organizationId: "org_1", name: "Newsletter" },
      select: { id: true, name: true }
    });
    expect(summary.contactList).toEqual({
      id: "list_new",
      name: "Newsletter",
      created: true
    });
    expect(
      prismaMock.contactListMember.createMany.mock.calls[0][0].data
    ).toEqual([
      { contactListId: "list_new", contactId: "new", source: "CSV_IMPORT" }
    ]);
  });

  it("reuses a same-named list instead of creating duplicates on re-import", async () => {
    mockExisting();
    prismaMock.contactList.findFirst.mockResolvedValue({
      id: "list_existing",
      name: "Newsletter"
    } as never);
    prismaMock.contact.create.mockResolvedValue({ id: "new" } as never);
    prismaMock.contactListMember.createMany.mockResolvedValue({
      count: 1
    } as never);

    const summary = await contactService.importContacts({
      organizationId: "org_1",
      contactListName: "Newsletter",
      csv: "email\na@b.com\n"
    });

    expect(prismaMock.contactList.create).not.toHaveBeenCalled();
    expect(summary.contactList).toEqual({
      id: "list_existing",
      name: "Newsletter",
      created: false
    });
  });

  it("trims a list name and rejects one that is only whitespace", async () => {
    mockExisting();
    prismaMock.contactList.findFirst.mockResolvedValue(null as never);

    await expect(
      contactService.importContacts({
        organizationId: "org_1",
        contactListName: "   ",
        csv: "email\na@b.com\n"
      })
    ).rejects.toThrow("Contact list name is required");
  });

  it("omits the list summary when no list was targeted", async () => {
    mockExisting();
    prismaMock.contact.create.mockResolvedValue({ id: "new" } as never);

    const summary = await contactService.importContacts({
      organizationId: "org_1",
      csv: "email\na@b.com\n"
    });

    expect(summary.contactList).toBeUndefined();
    expect(prismaMock.contactListMember.createMany).not.toHaveBeenCalled();
  });
});

describe("contactService.bulkDelete", () => {
  it("deletes many contacts scoped to the org and the caller's membership", async () => {
    prismaMock.contact.deleteMany.mockResolvedValue({ count: 2 } as never);

    const result = await contactService.bulkDelete("org_1", "user_1", [
      "c1",
      "c2"
    ]);

    expect(prismaMock.contact.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["c1", "c2"] },
        organizationId: "org_1",
        organization: { members: { some: { userId: "user_1" } } }
      }
    });
    expect(result).toEqual({ deleted: 2 });
  });

  it("reports a partial count when some ids are not the caller's", async () => {
    // Ids outside the org are filtered out by the scoping rather than erroring,
    // so the caller learns how many were actually removed.
    prismaMock.contact.deleteMany.mockResolvedValue({ count: 1 } as never);

    const result = await contactService.bulkDelete("org_1", "user_1", [
      "mine",
      "someone-elses"
    ]);

    expect(result).toEqual({ deleted: 1 });
  });
});

describe("contactService.activity", () => {
  it("throws 404 for a contact the user does not own", async () => {
    prismaMock.contact.findFirst.mockResolvedValue(null);
    await expect(
      contactService.activity("c1", "user_1", { limit: 50 })
    ).rejects.toThrow("Contact not found");
  });

  it("returns an empty timeline when the contact has no email jobs", async () => {
    prismaMock.contact.findFirst.mockResolvedValue({
      id: "c1",
      organizationId: "org_1",
      email: "a@b.com"
    } as never);
    prismaMock.emailJob.findMany.mockResolvedValue([] as never);

    const result = await contactService.activity("c1", "user_1", { limit: 50 });
    expect(result).toEqual({ events: [], nextCursor: null });
    expect(prismaMock.emailEvent.findMany).not.toHaveBeenCalled();
  });

  it("correlates events by recipient address and enriches with job/campaign", async () => {
    prismaMock.contact.findFirst.mockResolvedValue({
      id: "c1",
      organizationId: "org_1",
      email: "a@b.com"
    } as never);
    prismaMock.emailJob.findMany.mockResolvedValue([
      {
        id: "job_1",
        subject: "Welcome",
        origin: "CAMPAIGN",
        campaign: { name: "Spring" }
      }
    ] as never);
    prismaMock.emailEvent.findMany.mockResolvedValue([
      {
        id: "e1",
        type: "CLICKED",
        occurredAt: new Date("2026-02-01T00:00:00.000Z"),
        emailJobId: "job_1",
        metadata: { url: "https://x.com" }
      }
    ] as never);

    const result = await contactService.activity("c1", "user_1", { limit: 50 });

    // Correlated by org + recipient email.
    expect(prismaMock.emailJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1", toEmail: "a@b.com" }
      })
    );
    expect(result.events[0]).toMatchObject({
      type: "CLICKED",
      subject: "Welcome",
      origin: "CAMPAIGN",
      campaignName: "Spring",
      url: "https://x.com"
    });
    expect(result.nextCursor).toBeNull();
  });

  it("sets nextCursor when there is another page", async () => {
    prismaMock.contact.findFirst.mockResolvedValue({
      id: "c1",
      organizationId: "org_1",
      email: "a@b.com"
    } as never);
    prismaMock.emailJob.findMany.mockResolvedValue([
      { id: "job_1", subject: "S", origin: "MANUAL", campaign: null }
    ] as never);
    // limit 1 + 1 sentinel = two rows returned.
    prismaMock.emailEvent.findMany.mockResolvedValue([
      { id: "e2", type: "SENT", occurredAt: new Date(), emailJobId: "job_1", metadata: null },
      { id: "e1", type: "QUEUED", occurredAt: new Date(), emailJobId: "job_1", metadata: null }
    ] as never);

    const result = await contactService.activity("c1", "user_1", { limit: 1 });
    expect(result.events).toHaveLength(1);
    expect(result.nextCursor).toBe("e2");
  });
});

describe("contactService.previewSegment", () => {
  it("uses hasSome for ANY match and returns count + sample", async () => {
    prismaMock.contact.count.mockResolvedValue(3 as never);
    prismaMock.contact.findMany.mockResolvedValue([{ id: "c1" }] as never);

    const result = await contactService.previewSegment({
      organizationId: "org_1",
      tags: ["vip", "gold"],
      match: "ANY"
    });

    expect(result).toEqual({ count: 3, sample: [{ id: "c1" }] });
    expect(prismaMock.contact.count.mock.calls[0][0].where).toMatchObject({
      organizationId: "org_1",
      tags: { hasSome: ["vip", "gold"] }
    });
  });

  it("uses hasEvery for ALL match and applies a status filter", async () => {
    prismaMock.contact.count.mockResolvedValue(1 as never);
    prismaMock.contact.findMany.mockResolvedValue([] as never);

    await contactService.previewSegment({
      organizationId: "org_1",
      tags: ["vip", "gold"],
      match: "ALL",
      status: "ACTIVE"
    });

    expect(prismaMock.contact.count.mock.calls[0][0].where).toMatchObject({
      tags: { hasEvery: ["vip", "gold"] },
      status: "ACTIVE"
    });
  });
});

describe("contactService.exportContacts", () => {
  it("serializes contacts to CSV with a header row", async () => {
    prismaMock.contact.findMany.mockResolvedValue([
      {
        email: "a@b.com",
        firstName: "Ann",
        lastName: "Bee",
        status: "ACTIVE",
        tags: ["vip", "gold"],
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      }
    ] as never);

    const csv = await contactService.exportContacts("org_1");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("email,firstName,lastName,status,tags,createdAt");
    expect(lines[1]).toContain("a@b.com");
    expect(lines[1]).toContain('"vip, gold"');
  });
});
