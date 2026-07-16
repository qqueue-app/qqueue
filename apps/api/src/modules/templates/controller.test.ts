import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  templateService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    clone: vi.fn(),
    preview: vi.fn(),
    testSend: vi.fn()
  }
}));

const { templateController } = await import("./controller.js");
const { templateService } = await import("./service.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

const templateBody = {
  organizationId: "org_1",
  name: "Welcome",
  description: "Sent on signup",
  category: "onboarding",
  tags: ["lifecycle"],
  subject: "Welcome, {{firstName}}",
  html: "<p>Hi {{firstName}}</p>",
  mjml: "<mjml><mj-body>Hi {{firstName}}</mj-body></mjml>",
  text: "Hi {{firstName}}",
  variables: [{ name: "firstName", label: "First name", defaultValue: "there" }],
  previewData: { firstName: "Ada" }
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("templateController.list", () => {
  it("lists templates for the org pinned by requireOrgMembership", async () => {
    const rows = [{ id: "tpl_1" }];
    vi.mocked(templateService.list).mockResolvedValue(rows as never);
    const res = mockRes();

    await templateController.list({ organizationId: "org_1" } as Request, res);

    expect(templateService.list).toHaveBeenCalledWith("org_1");
    expect(res.json).toHaveBeenCalledWith({ data: rows });
  });
});

describe("templateController.get", () => {
  it("returns the template when the service resolves one", async () => {
    const template = { id: "tpl_1" };
    vi.mocked(templateService.get).mockResolvedValue(template as never);
    const res = mockRes();

    await templateController.get(
      { params: { id: "tpl_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    // Lookup is scoped by user membership, not by the pinned org id.
    expect(templateService.get).toHaveBeenCalledWith("tpl_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: template });
  });

  it("responds 404 when the template is not visible to the user", async () => {
    vi.mocked(templateService.get).mockResolvedValue(null as never);
    const res = mockRes();

    await templateController.get(
      { params: { id: "missing" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: "Template not found" }
    });
  });
});

describe("templateController.create", () => {
  it("creates a template with its metadata and declared variables, responding 201", async () => {
    const created = { id: "tpl_1" };
    vi.mocked(templateService.create).mockResolvedValue(created as never);
    const res = mockRes();

    await templateController.create({ body: templateBody } as Request, res);

    expect(templateService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        name: "Welcome",
        tags: ["lifecycle"],
        variables: [
          { name: "firstName", label: "First name", defaultValue: "there" }
        ],
        previewData: { firstName: "Ada" }
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: created });
  });

  it("rejects a body missing the required subject/html", async () => {
    await expect(
      templateController.create(
        { body: { organizationId: "org_1", name: "Welcome" } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(templateService.create).not.toHaveBeenCalled();
  });

  it("rejects a variable name that breaks the {{token}} grammar", async () => {
    // Variable names must be substitutable in a `{{name}}` token, so the schema
    // restricts them to word chars, dots, and hyphens.
    await expect(
      templateController.create(
        {
          body: { ...templateBody, variables: [{ name: "first name!" }] }
        } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(templateService.create).not.toHaveBeenCalled();
  });
});

describe("templateController.update", () => {
  it("updates a template scoped to the requesting user", async () => {
    const updated = { id: "tpl_1", name: "Welcome" };
    vi.mocked(templateService.update).mockResolvedValue(updated as never);
    const res = mockRes();

    await templateController.update(
      {
        params: { id: "tpl_1" },
        userId: "usr_1",
        body: templateBody
      } as unknown as Request,
      res
    );

    expect(templateService.update).toHaveBeenCalledWith(
      "tpl_1",
      "usr_1",
      expect.objectContaining({ name: "Welcome" })
    );
    expect(res.json).toHaveBeenCalledWith({ data: updated });
  });

  it("rejects an invalid update body", async () => {
    await expect(
      templateController.update(
        {
          params: { id: "tpl_1" },
          userId: "usr_1",
          body: { ...templateBody, subject: "" }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(templateService.update).not.toHaveBeenCalled();
  });
});

describe("templateController.delete", () => {
  it("deletes by id and responds 204 with no body", async () => {
    vi.mocked(templateService.delete).mockResolvedValue(undefined as never);
    const res = mockRes();

    await templateController.delete(
      { params: { id: "tpl_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(templateService.delete).toHaveBeenCalledWith("tpl_1", "usr_1");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});

describe("templateController.clone", () => {
  it("clones by id and responds 201 with the new template", async () => {
    const clone = { id: "tpl_2", name: "Welcome copy" };
    vi.mocked(templateService.clone).mockResolvedValue(clone as never);
    const res = mockRes();

    await templateController.clone(
      { params: { id: "tpl_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    // Clone takes no body: the source template supplies every field.
    expect(templateService.clone).toHaveBeenCalledWith("tpl_1", "usr_1");
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: clone });
  });

  it("propagates a not-found from the service", async () => {
    vi.mocked(templateService.clone).mockRejectedValue(
      new Error("Template not found")
    );

    await expect(
      templateController.clone(
        { params: { id: "missing" }, userId: "usr_1" } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow("Template not found");
  });
});

describe("templateController.preview", () => {
  it("renders a saved template by id with sample data", async () => {
    const result = { subject: "Welcome, Ada", html: "<p>Hi Ada</p>" };
    vi.mocked(templateService.preview).mockResolvedValue(result as never);
    const res = mockRes();

    await templateController.preview(
      {
        userId: "usr_1",
        body: {
          organizationId: "org_1",
          templateId: "tpl_1",
          data: { firstName: "Ada" }
        }
      } as Request,
      res
    );

    expect(templateService.preview).toHaveBeenCalledWith(
      {
        organizationId: "org_1",
        templateId: "tpl_1",
        data: { firstName: "Ada" }
      },
      "usr_1"
    );
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("renders unsaved subject/html supplied inline, without a templateId", async () => {
    // The composer previews drafts that were never saved, so templateId is
    // optional and the body itself carries subject/html.
    const result = { subject: "Hi Ada", html: "<p>Ada</p>" };
    vi.mocked(templateService.preview).mockResolvedValue(result as never);
    const res = mockRes();

    await templateController.preview(
      {
        userId: "usr_1",
        body: {
          organizationId: "org_1",
          subject: "Hi {{firstName}}",
          html: "<p>{{firstName}}</p>",
          variables: [{ name: "firstName" }],
          data: { firstName: "Ada" }
        }
      } as Request,
      res
    );

    expect(templateService.preview).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Hi {{firstName}}" }),
      "usr_1"
    );
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("rejects a preview body missing organizationId", async () => {
    await expect(
      templateController.preview(
        { userId: "usr_1", body: { templateId: "tpl_1" } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(templateService.preview).not.toHaveBeenCalled();
  });
});

describe("templateController.testSend", () => {
  it("queues a test send and responds 202", async () => {
    const result = { id: "job_1", status: "QUEUED" };
    vi.mocked(templateService.testSend).mockResolvedValue(result as never);
    const res = mockRes();

    await templateController.testSend(
      {
        params: { id: "tpl_1" },
        userId: "usr_1",
        body: {
          organizationId: "org_1",
          to: "qa@example.com",
          data: { firstName: "Ada" },
          smtpConnectionId: "smtp_1"
        }
      } as unknown as Request,
      res
    );

    // 202: the send is handed to the delivery pipeline, not completed inline.
    expect(templateService.testSend).toHaveBeenCalledWith("tpl_1", "usr_1", {
      organizationId: "org_1",
      to: "qa@example.com",
      data: { firstName: "Ada" },
      smtpConnectionId: "smtp_1"
    });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("omits `to` and smtpConnectionId, leaving both to be resolved server-side", async () => {
    // `to` defaults to the authenticated user; the sending identity resolves
    // from the org's default SMTP connection. Neither is built here.
    vi.mocked(templateService.testSend).mockResolvedValue({
      id: "job_2"
    } as never);
    const res = mockRes();

    await templateController.testSend(
      {
        params: { id: "tpl_1" },
        userId: "usr_1",
        body: { organizationId: "org_1" }
      } as unknown as Request,
      res
    );

    expect(templateService.testSend).toHaveBeenCalledWith("tpl_1", "usr_1", {
      organizationId: "org_1"
    });
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it("rejects a test send to a malformed address", async () => {
    await expect(
      templateController.testSend(
        {
          params: { id: "tpl_1" },
          userId: "usr_1",
          body: { organizationId: "org_1", to: "not-an-email" }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(templateService.testSend).not.toHaveBeenCalled();
  });
});
