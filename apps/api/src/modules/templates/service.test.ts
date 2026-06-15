import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";
import { templateService } from "./service.js";

const input = {
  organizationId: "org_1",
  name: "Welcome",
  subject: "Hi",
  html: "<p>Hi</p>",
  mjml: "<mjml><mj-body><mj-text>Hi</mj-text></mj-body></mjml>",
  text: "Hi"
};

describe("templateService", () => {
  it("lists templates for an organization", () => {
    prismaMock.template.findMany.mockResolvedValue([] as never);
    templateService.list("org_1");
    expect(prismaMock.template.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      orderBy: { createdAt: "desc" }
    });
  });

  it("gets a template scoped by membership", () => {
    prismaMock.template.findFirst.mockResolvedValue({ id: "t1" } as never);
    templateService.get("t1", "user_1");
    expect(prismaMock.template.findFirst).toHaveBeenCalled();
  });

  it("creates a template", async () => {
    prismaMock.template.create.mockResolvedValue({ id: "t1" } as never);
    await templateService.create(input);
    expect(prismaMock.template.create).toHaveBeenCalledWith({ data: input });
  });

  it("updates an owned template", async () => {
    prismaMock.template.findFirst.mockResolvedValue({ id: "t1" } as never);
    prismaMock.template.update.mockResolvedValue({ id: "t1" } as never);
    await templateService.update("t1", "user_1", input);
    expect(prismaMock.template.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: {
        name: input.name,
        subject: input.subject,
        html: input.html,
        mjml: input.mjml,
        text: input.text
      }
    });
  });

  it("throws 404 updating a template the user does not own", async () => {
    prismaMock.template.findFirst.mockResolvedValue(null);
    await expect(templateService.update("t1", "user_1", input)).rejects.toThrow(
      HttpError
    );
  });

  it("deletes an owned template", async () => {
    prismaMock.template.deleteMany.mockResolvedValue({ count: 1 } as never);
    await templateService.delete("t1", "user_1");
    expect(prismaMock.template.deleteMany).toHaveBeenCalled();
  });

  it("throws 404 deleting a template that does not exist", async () => {
    prismaMock.template.deleteMany.mockResolvedValue({ count: 0 } as never);
    await expect(templateService.delete("t1", "user_1")).rejects.toThrow(
      "Template not found"
    );
  });
});
