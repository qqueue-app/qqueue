import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  inboxService: {
    listAccounts: vi.fn(),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    deleteAccount: vi.fn(),
    listMessages: vi.fn(),
    storeInboundMessage: vi.fn(),
    markRead: vi.fn(),
    replyToMessage: vi.fn()
  }
}));

const { inboxController } = await import("./controller.js");
const { inboxService } = await import("./service.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

const validAccountBody = {
  organizationId: "org_1",
  name: "Support",
  email: "support@example.com",
  host: "imap.example.com",
  port: 993,
  secure: true,
  username: "support",
  password: "s3cret",
  mailbox: "INBOX"
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("inboxController.listAccounts", () => {
  it("lists accounts for the org pinned by requireOrgMembership", async () => {
    const rows = [{ id: "iba_1" }];
    vi.mocked(inboxService.listAccounts).mockResolvedValue(rows as never);
    const res = mockRes();

    await inboxController.listAccounts({ organizationId: "org_1" } as Request, res);

    expect(inboxService.listAccounts).toHaveBeenCalledWith("org_1");
    expect(res.json).toHaveBeenCalledWith({ data: rows });
  });
});

describe("inboxController.createAccount", () => {
  it("creates an account from a validated body and responds 201", async () => {
    const created = { id: "iba_1" };
    vi.mocked(inboxService.createAccount).mockResolvedValue(created as never);
    const res = mockRes();

    await inboxController.createAccount({ body: validAccountBody } as Request, res);

    expect(inboxService.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", host: "imap.example.com" })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: created });
  });

  it("applies the schema's port/secure/mailbox defaults when omitted", async () => {
    vi.mocked(inboxService.createAccount).mockResolvedValue({ id: "iba_1" } as never);

    await inboxController.createAccount(
      {
        body: {
          organizationId: "org_1",
          name: "Support",
          email: "support@example.com",
          host: "imap.example.com",
          username: "support",
          password: "s3cret"
        }
      } as Request,
      mockRes()
    );

    expect(inboxService.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ port: 993, secure: true, mailbox: "INBOX" })
    );
  });

  it("rejects an invalid body before reaching the service", async () => {
    await expect(
      inboxController.createAccount(
        { body: { ...validAccountBody, email: "not-an-email" } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(inboxService.createAccount).not.toHaveBeenCalled();
  });

  it("surfaces an IMAP verification failure from the service", async () => {
    vi.mocked(inboxService.createAccount).mockRejectedValue(
      new Error("Could not connect to the IMAP mailbox with those settings")
    );

    await expect(
      inboxController.createAccount({ body: validAccountBody } as Request, mockRes())
    ).rejects.toThrow("Could not connect to the IMAP mailbox with those settings");
  });
});

describe("inboxController.updateAccount", () => {
  it("passes the validated partial body through to the service", async () => {
    const updated = { id: "iba_1", status: "DISABLED" };
    vi.mocked(inboxService.updateAccount).mockResolvedValue(updated as never);
    const res = mockRes();

    await inboxController.updateAccount(
      {
        params: { id: "iba_1" },
        userId: "usr_1",
        body: { name: "Renamed", status: "DISABLED" }
      } as unknown as Request,
      res
    );

    expect(inboxService.updateAccount).toHaveBeenCalledWith("iba_1", "usr_1", {
      name: "Renamed",
      status: "DISABLED"
    });
    expect(res.json).toHaveBeenCalledWith({ data: updated });
  });

  it("rejects an unknown status value before reaching the service", async () => {
    await expect(
      inboxController.updateAccount(
        {
          params: { id: "iba_1" },
          userId: "usr_1",
          body: { status: "PAUSED" }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(inboxService.updateAccount).not.toHaveBeenCalled();
  });
});

describe("inboxController.deleteAccount", () => {
  it("deletes by id and responds 204 with no body", async () => {
    vi.mocked(inboxService.deleteAccount).mockResolvedValue(undefined as never);
    const res = mockRes();

    await inboxController.deleteAccount(
      { params: { id: "iba_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(inboxService.deleteAccount).toHaveBeenCalledWith("iba_1", "usr_1");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});

describe("inboxController.listMessages", () => {
  it("parses the query string and returns the service's paginated envelope", async () => {
    const result = { data: [{ id: "ibm_1" }], nextCursor: "ibm_2" };
    vi.mocked(inboxService.listMessages).mockResolvedValue(result as never);
    const res = mockRes();

    await inboxController.listMessages(
      {
        query: { organizationId: "org_1", read: "unread", q: "invoice", limit: "10" }
      } as unknown as Request,
      res
    );

    // limit arrives as a string on req.query and is coerced by the schema.
    expect(inboxService.listMessages).toHaveBeenCalledWith({
      organizationId: "org_1",
      read: "unread",
      q: "invoice",
      limit: 10
    });
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("rejects a query missing organizationId", async () => {
    await expect(
      inboxController.listMessages({ query: {} } as unknown as Request, mockRes())
    ).rejects.toThrow();
    expect(inboxService.listMessages).not.toHaveBeenCalled();
  });
});

describe("inboxController.storeInboundMessage", () => {
  it("stores a normalized inbound message and responds 201", async () => {
    const stored = { id: "ibm_1" };
    vi.mocked(inboxService.storeInboundMessage).mockResolvedValue(stored as never);
    const res = mockRes();

    await inboxController.storeInboundMessage(
      {
        body: {
          organizationId: "org_1",
          inboxAccountId: "iba_1",
          messageId: "<abc@example.com>",
          inReplyTo: "<orig@example.com>",
          references: ["<orig@example.com>"],
          fromEmail: "customer@example.com",
          fromName: "Customer",
          to: ["support@example.com"],
          subject: "Re: Invoice",
          text: "Thanks",
          receivedAt: "2026-07-16T10:00:00.000Z"
        }
      } as Request,
      res
    );

    expect(inboxService.storeInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "<abc@example.com>",
        references: ["<orig@example.com>"],
        cc: []
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: stored });
  });

  it("rejects a non-datetime receivedAt before reaching the service", async () => {
    await expect(
      inboxController.storeInboundMessage(
        {
          body: {
            organizationId: "org_1",
            inboxAccountId: "iba_1",
            messageId: "<abc@example.com>",
            fromEmail: "customer@example.com",
            receivedAt: "yesterday"
          }
        } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(inboxService.storeInboundMessage).not.toHaveBeenCalled();
  });
});

describe("inboxController.markRead", () => {
  it("defaults to marking read when the body omits `read`", async () => {
    const message = { id: "ibm_1" };
    vi.mocked(inboxService.markRead).mockResolvedValue(message as never);
    const res = mockRes();

    await inboxController.markRead(
      { params: { id: "ibm_1" }, userId: "usr_1", body: {} } as unknown as Request,
      res
    );

    expect(inboxService.markRead).toHaveBeenCalledWith("ibm_1", "usr_1", true);
    expect(res.json).toHaveBeenCalledWith({ data: message });
  });

  it("marks unread when read is boolean false", async () => {
    vi.mocked(inboxService.markRead).mockResolvedValue({ id: "ibm_1" } as never);

    await inboxController.markRead(
      { params: { id: "ibm_1" }, userId: "usr_1", body: { read: false } } as unknown as Request,
      mockRes()
    );

    expect(inboxService.markRead).toHaveBeenCalledWith("ibm_1", "usr_1", false);
  });

  it('coerces the string "false" to a boolean', async () => {
    vi.mocked(inboxService.markRead).mockResolvedValue({ id: "ibm_1" } as never);

    await inboxController.markRead(
      {
        params: { id: "ibm_1" },
        userId: "usr_1",
        body: { read: "false" }
      } as unknown as Request,
      mockRes()
    );

    expect(inboxService.markRead).toHaveBeenCalledWith("ibm_1", "usr_1", false);
  });

  it('coerces the string "true" to a boolean', async () => {
    vi.mocked(inboxService.markRead).mockResolvedValue({ id: "ibm_1" } as never);

    await inboxController.markRead(
      {
        params: { id: "ibm_1" },
        userId: "usr_1",
        body: { read: "true" }
      } as unknown as Request,
      mockRes()
    );

    expect(inboxService.markRead).toHaveBeenCalledWith("ibm_1", "usr_1", true);
  });

  it("rejects a read value that is neither boolean nor a known string", async () => {
    await expect(
      inboxController.markRead(
        {
          params: { id: "ibm_1" },
          userId: "usr_1",
          body: { read: "maybe" }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(inboxService.markRead).not.toHaveBeenCalled();
  });
});

describe("inboxController.replyToMessage", () => {
  it("queues a reply and responds 202 — sending is async via the pipeline", async () => {
    const result = { emailJobId: "job_1" };
    vi.mocked(inboxService.replyToMessage).mockResolvedValue(result as never);
    const res = mockRes();

    await inboxController.replyToMessage(
      {
        params: { id: "ibm_1" },
        userId: "usr_1",
        body: {
          organizationId: "org_1",
          smtpConnectionId: "smtp_1",
          subject: "Re: Invoice",
          html: "<p>On it</p>"
        }
      } as unknown as Request,
      res
    );

    expect(inboxService.replyToMessage).toHaveBeenCalledWith("ibm_1", "usr_1", {
      organizationId: "org_1",
      smtpConnectionId: "smtp_1",
      subject: "Re: Invoice",
      html: "<p>On it</p>"
    });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("rejects a reply with neither html nor text — the schema refines on a body", async () => {
    await expect(
      inboxController.replyToMessage(
        {
          params: { id: "ibm_1" },
          userId: "usr_1",
          body: { organizationId: "org_1", subject: "Re: Invoice" }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(inboxService.replyToMessage).not.toHaveBeenCalled();
  });

  it("surfaces a not-found inbound message from the service", async () => {
    vi.mocked(inboxService.replyToMessage).mockRejectedValue(
      new Error("Inbound message not found")
    );

    await expect(
      inboxController.replyToMessage(
        {
          params: { id: "missing" },
          userId: "usr_1",
          body: { organizationId: "org_1", subject: "Re: Invoice", text: "hi" }
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow("Inbound message not found");
  });
});
