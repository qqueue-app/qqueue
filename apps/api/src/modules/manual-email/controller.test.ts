import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
//
// Manual sends are one entry point into the single delivery pipeline: this
// controller must only hand off to manualEmailService (which resolves
// recipients then delegates to transactionalEmailService.send). Any direct
// send from here would be a parallel delivery path.
vi.mock("./service.js", () => ({
  manualEmailService: {
    send: vi.fn(),
    preview: vi.fn(),
    deliveryStatus: vi.fn()
  }
}));

const { manualEmailController } = await import("./controller.js");
const { manualEmailService } = await import("./service.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manualEmailController.send", () => {
  it("delegates the validated send to the service and responds 202", async () => {
    const result = { emailJobId: "job_1" };
    vi.mocked(manualEmailService.send).mockResolvedValue(result as never);
    const res = mockRes();

    const body = {
      organizationId: "org_1",
      to: ["recipient@example.com"],
      subject: "Release notes",
      html: "<p>Hello</p>"
    };

    await manualEmailController.send(
      { body, userId: "usr_1" } as Request,
      res
    );

    // userId comes from requireAuth, not the body — it is passed separately so
    // the resulting EmailJob records createdByUserId.
    expect(manualEmailService.send).toHaveBeenCalledWith(
      expect.objectContaining(body),
      "usr_1"
    );
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("passes an explicit smtpConnectionId through untouched", async () => {
    vi.mocked(manualEmailService.send).mockResolvedValue({} as never);

    await manualEmailController.send(
      {
        body: {
          organizationId: "org_1",
          contactIds: ["con_1"],
          subject: "Hi",
          text: "Hello",
          smtpConnectionId: "smtp_2"
        },
        userId: "usr_1"
      } as Request,
      mockRes()
    );

    // Who the message sends as is resolved from the SMTP connection, so the id
    // must survive the adapter rather than being replaced by a From header.
    expect(manualEmailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ smtpConnectionId: "smtp_2" }),
      "usr_1"
    );
  });

  it("rejects a send with no recipients before reaching the service", async () => {
    await expect(
      manualEmailController.send(
        {
          body: {
            organizationId: "org_1",
            subject: "Nobody",
            html: "<p>Hi</p>"
          },
          userId: "usr_1"
        } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(manualEmailService.send).not.toHaveBeenCalled();
  });

  it("rejects a send with no body content before reaching the service", async () => {
    await expect(
      manualEmailController.send(
        {
          body: {
            organizationId: "org_1",
            to: ["recipient@example.com"],
            subject: "Empty"
          },
          userId: "usr_1"
        } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(manualEmailService.send).not.toHaveBeenCalled();
  });
});

describe("manualEmailController.preview", () => {
  it("renders a preview of the validated draft", async () => {
    const result = {
      subject: "Release notes",
      html: "<p>Hello</p>",
      recipients: { to: ["a@example.com"], cc: [], bcc: [], total: 1 }
    };
    vi.mocked(manualEmailService.preview).mockResolvedValue(result as never);
    const res = mockRes();

    await manualEmailController.preview(
      {
        body: {
          organizationId: "org_1",
          subject: "Release notes",
          html: "<p>Hello</p>",
          to: ["a@example.com"]
        }
      } as Request,
      res
    );

    expect(manualEmailService.preview).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1" })
    );
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("previews a half-finished draft with only an organizationId", async () => {
    vi.mocked(manualEmailService.preview).mockResolvedValue({} as never);

    await manualEmailController.preview(
      { body: { organizationId: "org_1" } } as Request,
      mockRes()
    );

    expect(manualEmailService.preview).toHaveBeenCalledWith({
      organizationId: "org_1"
    });
  });

  it("rejects a preview with no organizationId", async () => {
    await expect(
      manualEmailController.preview({ body: {} } as Request, mockRes())
    ).rejects.toThrow();
    expect(manualEmailService.preview).not.toHaveBeenCalled();
  });
});

describe("manualEmailController.status", () => {
  it("returns per-recipient delivery status scoped to the pinned org", async () => {
    const result = { recipients: [{ email: "a@example.com", status: "delivered" }] };
    vi.mocked(manualEmailService.deliveryStatus).mockResolvedValue(result as never);
    const res = mockRes();

    await manualEmailController.status(
      {
        params: { emailJobId: "job_1" },
        organizationId: "org_1"
      } as unknown as Request,
      res
    );

    expect(manualEmailService.deliveryStatus).toHaveBeenCalledWith("job_1", "org_1");
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });
});
