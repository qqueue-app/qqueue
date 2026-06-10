import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";
import { contactService } from "./service.js";

const input = {
  organizationId: "org_1",
  email: "a@b.com",
  firstName: "A",
  lastName: "B",
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

  it("creates a contact", () => {
    prismaMock.contact.create.mockResolvedValue({ id: "c1" } as never);
    contactService.create(input);
    expect(prismaMock.contact.create).toHaveBeenCalled();
  });

  it("updates an owned contact", async () => {
    prismaMock.contact.findFirst.mockResolvedValue({ id: "c1" } as never);
    prismaMock.contact.update.mockResolvedValue({ id: "c1" } as never);
    await contactService.update("c1", "user_1", input);
    expect(prismaMock.contact.update).toHaveBeenCalled();
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
