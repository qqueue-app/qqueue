import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";
import { contactListService } from "./service.js";

// A contact list as Prisma returns it with the membership join hydrated. The
// service flattens this back to the legacy `contacts` + `_count.contacts` shape.
function listWithMembers(overrides: Record<string, unknown> = {}) {
  return {
    id: "l1",
    organizationId: "org_1",
    name: "List",
    description: null,
    members: [
      { contact: { id: "c1", email: "a@b.com", status: "ACTIVE" } }
    ],
    _count: { members: 1, campaigns: 2 },
    ...overrides
  };
}

describe("contactListService", () => {
  it("lists contact lists and flattens members to contacts", async () => {
    prismaMock.contactList.findMany.mockResolvedValue([listWithMembers()] as never);
    const result = await contactListService.list("org_1");
    expect(prismaMock.contactList.findMany).toHaveBeenCalled();
    expect(result[0].contacts).toEqual([{ id: "c1", email: "a@b.com", status: "ACTIVE" }]);
    expect(result[0]._count).toEqual({ contacts: 1, campaigns: 2 });
  });

  it("gets a contact list scoped by membership", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue(listWithMembers() as never);
    const result = await contactListService.get("l1", "user_1");
    expect(prismaMock.contactList.findFirst).toHaveBeenCalled();
    expect(result?.contacts).toHaveLength(1);
  });

  it("returns null when getting a list the user does not own", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue(null);
    const result = await contactListService.get("l1", "user_1");
    expect(result).toBeNull();
  });

  it("creates a list with no members", async () => {
    prismaMock.contactList.create.mockResolvedValue(
      listWithMembers({ members: [], _count: { members: 0, campaigns: 0 } }) as never
    );
    await contactListService.create({ organizationId: "org_1", name: "List" });
    const call = prismaMock.contactList.create.mock.calls[0][0];
    expect(call.data.members).toBeUndefined();
  });

  it("creates a list connecting unique contacts after validating them", async () => {
    prismaMock.contact.count.mockResolvedValue(2 as never);
    prismaMock.contactList.create.mockResolvedValue(listWithMembers() as never);
    await contactListService.create({
      organizationId: "org_1",
      name: "List",
      description: "desc",
      contactIds: ["c1", "c2", "c1"]
    });
    expect(prismaMock.contact.count).toHaveBeenCalledWith({
      where: { organizationId: "org_1", id: { in: ["c1", "c2"] } }
    });
    const call = prismaMock.contactList.create.mock.calls[0][0];
    expect(call.data.description).toBe("desc");
    expect(call.data.members).toEqual({
      create: [
        { contact: { connect: { id: "c1" } } },
        { contact: { connect: { id: "c2" } } }
      ]
    });
  });

  it("throws 400 when some contacts are not in the organization", async () => {
    prismaMock.contact.count.mockResolvedValue(1 as never);
    await expect(
      contactListService.create({
        organizationId: "org_1",
        name: "List",
        contactIds: ["c1", "c2"]
      })
    ).rejects.toThrow("One or more contacts do not belong to this organization");
  });

  it("replaces membership when updating with contactIds", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue({
      id: "l1",
      organizationId: "org_1"
    } as never);
    prismaMock.contact.count.mockResolvedValue(1 as never);
    prismaMock.contactListMember.deleteMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.contactListMember.createMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.contactList.update.mockResolvedValue(listWithMembers() as never);

    await contactListService.update("l1", "user_1", { name: "New", contactIds: ["c1"] });

    expect(prismaMock.contactListMember.deleteMany).toHaveBeenCalledWith({
      where: { contactListId: "l1" }
    });
    expect(prismaMock.contactListMember.createMany).toHaveBeenCalledWith({
      data: [{ contactId: "c1", contactListId: "l1" }]
    });
    const call = prismaMock.contactList.update.mock.calls[0][0];
    expect(call.data).toEqual({ name: "New", description: undefined });
  });

  it("leaves membership untouched when updating without contactIds", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue({
      id: "l1",
      organizationId: "org_1"
    } as never);
    prismaMock.contactList.update.mockResolvedValue(listWithMembers() as never);

    await contactListService.update("l1", "user_1", { name: "New" });

    expect(prismaMock.contactListMember.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.contactListMember.createMany).not.toHaveBeenCalled();
  });

  it("removes all members when updating with an empty contactIds array", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue({
      id: "l1",
      organizationId: "org_1"
    } as never);
    prismaMock.contactListMember.deleteMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.contactList.update.mockResolvedValue(
      listWithMembers({ members: [], _count: { members: 0, campaigns: 0 } }) as never
    );

    await contactListService.update("l1", "user_1", { contactIds: [] });

    expect(prismaMock.contactListMember.deleteMany).toHaveBeenCalledWith({
      where: { contactListId: "l1" }
    });
    expect(prismaMock.contactListMember.createMany).not.toHaveBeenCalled();
  });

  it("throws 404 updating a list the user does not own", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue(null);
    await expect(
      contactListService.update("l1", "user_1", { name: "x" })
    ).rejects.toThrow(HttpError);
  });

  it("deletes an owned list", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue({ id: "l1" } as never);
    prismaMock.contactList.delete.mockResolvedValue({ id: "l1" } as never);
    await contactListService.delete("l1", "user_1");
    expect(prismaMock.contactList.delete).toHaveBeenCalledWith({
      where: { id: "l1" }
    });
  });

  it("throws 404 deleting a list the user does not own", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue(null);
    await expect(contactListService.delete("l1", "user_1")).rejects.toThrow(
      "Contact list not found"
    );
  });

  it("creates a list from a segment with SEGMENT-sourced members", async () => {
    prismaMock.contact.findMany.mockResolvedValue([
      { id: "c1" },
      { id: "c2" }
    ] as never);
    prismaMock.contactList.create.mockResolvedValue(listWithMembers() as never);

    await contactListService.createFromSegment({
      organizationId: "org_1",
      name: "VIPs",
      tags: ["vip"],
      match: "ANY"
    });

    // Segment selection uses hasSome for ANY.
    expect(prismaMock.contact.findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: "org_1",
      tags: { hasSome: ["vip"] }
    });
    // Members are created from the matches and tagged SEGMENT.
    const createData = prismaMock.contactList.create.mock.calls[0][0].data;
    expect(createData.members.create).toEqual([
      { contact: { connect: { id: "c1" } }, source: "SEGMENT" },
      { contact: { connect: { id: "c2" } }, source: "SEGMENT" }
    ]);
  });

  it("creates an empty list when no contacts match the segment", async () => {
    prismaMock.contact.findMany.mockResolvedValue([] as never);
    prismaMock.contactList.create.mockResolvedValue(
      listWithMembers({ members: [], _count: { members: 0, campaigns: 0 } }) as never
    );

    await contactListService.createFromSegment({
      organizationId: "org_1",
      name: "Empty",
      tags: ["none"],
      match: "ALL"
    });

    expect(prismaMock.contactList.create.mock.calls[0][0].data.members).toBeUndefined();
  });
});
