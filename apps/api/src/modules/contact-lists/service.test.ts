import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";
import { contactListService } from "./service.js";

describe("contactListService", () => {
  it("lists contact lists for an organization", () => {
    prismaMock.contactList.findMany.mockResolvedValue([] as never);
    contactListService.list("org_1");
    expect(prismaMock.contactList.findMany).toHaveBeenCalled();
  });

  it("gets a contact list scoped by membership", () => {
    prismaMock.contactList.findFirst.mockResolvedValue({ id: "l1" } as never);
    contactListService.get("l1", "user_1");
    expect(prismaMock.contactList.findFirst).toHaveBeenCalled();
  });

  it("creates a list with no contacts", async () => {
    prismaMock.contactList.create.mockResolvedValue({ id: "l1" } as never);
    await contactListService.create({ organizationId: "org_1", name: "List" });
    const call = prismaMock.contactList.create.mock.calls[0][0];
    expect(call.data.contacts).toBeUndefined();
  });

  it("creates a list connecting unique contacts after validating them", async () => {
    prismaMock.contact.count.mockResolvedValue(2 as never);
    prismaMock.contactList.create.mockResolvedValue({ id: "l1" } as never);
    await contactListService.create({
      organizationId: "org_1",
      name: "List",
      contactIds: ["c1", "c2", "c1"]
    });
    expect(prismaMock.contact.count).toHaveBeenCalledWith({
      where: { organizationId: "org_1", id: { in: ["c1", "c2"] } }
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

  it("updates an owned list and sets contacts", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue({
      id: "l1",
      organizationId: "org_1"
    } as never);
    prismaMock.contact.count.mockResolvedValue(1 as never);
    prismaMock.contactList.update.mockResolvedValue({ id: "l1" } as never);
    await contactListService.update("l1", "user_1", {
      name: "New",
      contactIds: ["c1"]
    });
    const call = prismaMock.contactList.update.mock.calls[0][0];
    expect(call.data.contacts).toEqual({ set: [{ id: "c1" }] });
  });

  it("updates an owned list without touching contacts when none given", async () => {
    prismaMock.contactList.findFirst.mockResolvedValue({
      id: "l1",
      organizationId: "org_1"
    } as never);
    prismaMock.contactList.update.mockResolvedValue({ id: "l1" } as never);
    await contactListService.update("l1", "user_1", { name: "New" });
    const call = prismaMock.contactList.update.mock.calls[0][0];
    expect(call.data.contacts).toBeUndefined();
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
});
