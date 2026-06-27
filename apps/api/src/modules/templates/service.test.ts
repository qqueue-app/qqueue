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

// Persisted column shape (defaults applied for the new optional fields).
const persisted = {
  name: input.name,
  description: null,
  category: null,
  tags: [],
  subject: input.subject,
  html: input.html,
  mjml: input.mjml,
  text: input.text,
  variables: undefined,
  previewData: undefined
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
    expect(prismaMock.template.create).toHaveBeenCalledWith({
      data: { organizationId: input.organizationId, ...persisted }
    });
  });

  it("updates an owned template", async () => {
    prismaMock.template.findFirst.mockResolvedValue({ id: "t1" } as never);
    prismaMock.template.update.mockResolvedValue({ id: "t1" } as never);
    await templateService.update("t1", "user_1", input);
    expect(prismaMock.template.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: persisted
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

  it("clones an owned template with a ' copy' suffix", async () => {
    prismaMock.template.findFirst.mockResolvedValue({
      id: "t1",
      organizationId: "org_1",
      name: "Welcome",
      description: null,
      category: "Onboarding",
      tags: ["a"],
      subject: "Hi",
      html: "<p>Hi</p>",
      mjml: null,
      text: null,
      variables: null,
      previewData: null
    } as never);
    prismaMock.template.create.mockResolvedValue({ id: "t2" } as never);

    await templateService.clone("t1", "user_1");

    expect(prismaMock.template.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org_1",
        name: "Welcome copy",
        category: "Onboarding",
        tags: ["a"]
      })
    });
  });

  it("throws 404 cloning a template the user does not own", async () => {
    prismaMock.template.findFirst.mockResolvedValue(null);
    await expect(templateService.clone("t1", "user_1")).rejects.toThrow(
      HttpError
    );
  });

  it("previews ad-hoc html with variable substitution, no tracking", async () => {
    const result = await templateService.preview(
      {
        organizationId: "org_1",
        subject: "Hi {{firstName}}",
        html: "<p>Hello {{firstName}}, {{missing}}</p>",
        variables: [
          { name: "firstName", defaultValue: "Sam" },
          { name: "missing" }
        ]
      },
      "user_1"
    );

    expect(result.subject).toBe("Hi Sam");
    expect(result.html).toBe("<p>Hello Sam, </p>");
  });

  it("previews a saved template scoped by membership", async () => {
    prismaMock.template.findFirst.mockResolvedValue({
      id: "t1",
      subject: "Welcome {{firstName}}",
      html: "<p>{{firstName}}</p>",
      variables: [{ name: "firstName", defaultValue: "Sam" }]
    } as never);

    const result = await templateService.preview(
      { organizationId: "org_1", templateId: "t1", data: { firstName: "Jo" } },
      "user_1"
    );

    expect(result.subject).toBe("Welcome Jo");
    expect(result.html).toBe("<p>Jo</p>");
  });
});
