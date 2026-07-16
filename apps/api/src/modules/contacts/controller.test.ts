import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  contactService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    previewSegment: vi.fn(),
    activity: vi.fn(),
    importContacts: vi.fn(),
    exportContacts: vi.fn()
  }
}));

const { contactController } = await import("./controller.js");
const { contactService } = await import("./service.js");
const { HttpError } = await import("../../lib/http-error.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("contactController.list", () => {
  it("lists contacts for the org pinned by requireOrgMembership", async () => {
    const rows = [{ id: "con_1" }];
    vi.mocked(contactService.list).mockResolvedValue(rows as never);
    const res = mockRes();

    await contactController.list({ organizationId: "org_1" } as Request, res);

    expect(contactService.list).toHaveBeenCalledWith("org_1");
    expect(res.json).toHaveBeenCalledWith({ data: rows });
  });
});

describe("contactController.get", () => {
  it("returns the contact scoped to the requesting user", async () => {
    const row = { id: "con_1" };
    vi.mocked(contactService.get).mockResolvedValue(row as never);
    const res = mockRes();

    await contactController.get(
      { params: { id: "con_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(contactService.get).toHaveBeenCalledWith("con_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: row });
  });

  it("responds 404 when the contact is not visible to the user", async () => {
    vi.mocked(contactService.get).mockResolvedValue(null as never);
    const res = mockRes();

    await contactController.get(
      { params: { id: "missing" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: "Contact not found" }
    });
  });
});

describe("contactController.create", () => {
  it("creates a contact and responds 201", async () => {
    const created = { id: "con_1" };
    vi.mocked(contactService.create).mockResolvedValue(created as never);
    const res = mockRes();

    await contactController.create(
      {
        body: {
          organizationId: "org_1",
          email: "new@example.com",
          firstName: "Ada",
          tags: ["vip"]
        }
      } as Request,
      res
    );

    expect(contactService.create).toHaveBeenCalledWith({
      organizationId: "org_1",
      email: "new@example.com",
      firstName: "Ada",
      tags: ["vip"]
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: created });
  });

  it("rejects an invalid email before reaching the service", async () => {
    await expect(
      contactController.create(
        { body: { organizationId: "org_1", email: "not-an-email" } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(contactService.create).not.toHaveBeenCalled();
  });
});

describe("contactController.update", () => {
  it("updates the contact with the validated body", async () => {
    const updated = { id: "con_1" };
    vi.mocked(contactService.update).mockResolvedValue(updated as never);
    const res = mockRes();

    await contactController.update(
      {
        params: { id: "con_1" },
        userId: "usr_1",
        body: { organizationId: "org_1", email: "ada@example.com" }
      } as unknown as Request,
      res
    );

    expect(contactService.update).toHaveBeenCalledWith("con_1", "usr_1", {
      organizationId: "org_1",
      email: "ada@example.com"
    });
    expect(res.json).toHaveBeenCalledWith({ data: updated });
  });

  it("rejects an update missing the organizationId", async () => {
    await expect(
      contactController.update(
        {
          params: { id: "con_1" },
          userId: "usr_1",
          body: { email: "ada@example.com" }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(contactService.update).not.toHaveBeenCalled();
  });
});

describe("contactController.delete", () => {
  it("deletes by id and responds 204 with no body", async () => {
    vi.mocked(contactService.delete).mockResolvedValue(undefined as never);
    const res = mockRes();

    await contactController.delete(
      { params: { id: "con_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(contactService.delete).toHaveBeenCalledWith("con_1", "usr_1");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});

describe("contactController.previewSegment", () => {
  it("previews the validated tag filter", async () => {
    const result = { count: 3, contacts: [] };
    vi.mocked(contactService.previewSegment).mockResolvedValue(result as never);
    const res = mockRes();

    await contactController.previewSegment(
      {
        body: { organizationId: "org_1", tags: ["vip"], match: "ALL" }
      } as Request,
      res
    );

    expect(contactService.previewSegment).toHaveBeenCalledWith({
      organizationId: "org_1",
      tags: ["vip"],
      match: "ALL"
    });
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("rejects a filter with no tags", async () => {
    await expect(
      contactController.previewSegment(
        { body: { organizationId: "org_1", tags: [] } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(contactService.previewSegment).not.toHaveBeenCalled();
  });
});

describe("contactController.activity", () => {
  it("passes the parsed cursor/limit query to the service", async () => {
    const result = { events: [], nextCursor: null };
    vi.mocked(contactService.activity).mockResolvedValue(result as never);
    const res = mockRes();

    await contactController.activity(
      {
        params: { id: "con_1" },
        userId: "usr_1",
        // Express query values arrive as strings; the schema coerces `limit`.
        query: { cursor: "evt_9", limit: "10" }
      } as unknown as Request,
      res
    );

    expect(contactService.activity).toHaveBeenCalledWith("con_1", "usr_1", {
      cursor: "evt_9",
      limit: 10
    });
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("defaults limit to 50 when the query is empty", async () => {
    vi.mocked(contactService.activity).mockResolvedValue({} as never);

    await contactController.activity(
      { params: { id: "con_1" }, userId: "usr_1", query: {} } as unknown as Request,
      mockRes()
    );

    expect(contactService.activity).toHaveBeenCalledWith("con_1", "usr_1", {
      limit: 50
    });
  });

  it("rejects a limit above the maximum", async () => {
    await expect(
      contactController.activity(
        {
          params: { id: "con_1" },
          userId: "usr_1",
          query: { limit: "101" }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(contactService.activity).not.toHaveBeenCalled();
  });
});

describe("contactController.import", () => {
  const summary = { created: 2, updated: 0, skipped: 0, suppressed: 0, errors: [] };

  it("imports CSV from an uploaded multipart file", async () => {
    vi.mocked(contactService.importContacts).mockResolvedValue(summary as never);
    const res = mockRes();

    await contactController.import(
      {
        file: { buffer: Buffer.from("email\na@example.com\n", "utf8") },
        body: { organizationId: "org_1", contactListId: "lst_1" }
      } as unknown as Request,
      res
    );

    expect(contactService.importContacts).toHaveBeenCalledWith({
      organizationId: "org_1",
      csv: "email\na@example.com\n",
      contactListId: "lst_1"
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: summary });
  });

  it("imports CSV from a `csv` body field when no file is uploaded", async () => {
    vi.mocked(contactService.importContacts).mockResolvedValue(summary as never);
    const res = mockRes();

    await contactController.import(
      {
        body: { organizationId: "org_1", csv: "email\nb@example.com\n" }
      } as unknown as Request,
      res
    );

    expect(contactService.importContacts).toHaveBeenCalledWith({
      organizationId: "org_1",
      csv: "email\nb@example.com\n",
      contactListId: undefined
    });
    expect(res.json).toHaveBeenCalledWith({ data: summary });
  });

  it("throws a 400 when neither a file nor a csv field is present", async () => {
    await expect(
      contactController.import(
        { body: { organizationId: "org_1" } } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow(HttpError);
    expect(contactService.importContacts).not.toHaveBeenCalled();
  });

  it("throws a 400 when the csv body field is not a string", async () => {
    await expect(
      contactController.import(
        { body: { organizationId: "org_1", csv: 42 } } as unknown as Request,
        mockRes()
      )
    ).rejects.toMatchObject({ statusCode: 400, code: "validation_error" });
    expect(contactService.importContacts).not.toHaveBeenCalled();
  });

  it("throws a 400 when the request has no body at all", async () => {
    await expect(
      contactController.import({} as unknown as Request, mockRes())
    ).rejects.toThrow(HttpError);
    expect(contactService.importContacts).not.toHaveBeenCalled();
  });

  it("rejects an import with a CSV but no organizationId", async () => {
    await expect(
      contactController.import(
        { body: { csv: "email\nc@example.com\n" } } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(contactService.importContacts).not.toHaveBeenCalled();
  });
});

describe("contactController.export", () => {
  it("streams text/csv as an attachment rather than a JSON envelope", async () => {
    const csv = "email\na@example.com\n";
    vi.mocked(contactService.exportContacts).mockResolvedValue(csv as never);
    const res = mockRes();

    await contactController.export(
      { organizationId: "org_1", query: {} } as unknown as Request,
      res
    );

    expect(contactService.exportContacts).toHaveBeenCalledWith("org_1", undefined);
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "text/csv; charset=utf-8"
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="contacts.csv"'
    );
    expect(res.send).toHaveBeenCalledWith(csv);
    expect(res.json).not.toHaveBeenCalled();
  });

  it("narrows the export to a contact list when the query names one", async () => {
    vi.mocked(contactService.exportContacts).mockResolvedValue("" as never);

    await contactController.export(
      {
        organizationId: "org_1",
        query: { contactListId: "lst_1" }
      } as unknown as Request,
      mockRes()
    );

    expect(contactService.exportContacts).toHaveBeenCalledWith("org_1", "lst_1");
  });

  it("ignores a non-string contactListId query value", async () => {
    vi.mocked(contactService.exportContacts).mockResolvedValue("" as never);

    await contactController.export(
      {
        organizationId: "org_1",
        query: { contactListId: ["lst_1", "lst_2"] }
      } as unknown as Request,
      mockRes()
    );

    expect(contactService.exportContacts).toHaveBeenCalledWith("org_1", undefined);
  });
});
