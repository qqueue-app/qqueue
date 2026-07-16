import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract without re-testing service behaviour.
vi.mock("./service.js", () => ({
  transactionalEmailService: { send: vi.fn() }
}));

const { transactionalEmailController } = await import("./controller.js");
const { transactionalEmailService } = await import("./service.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

function mockReq(body: unknown, idempotencyKey?: string) {
  return {
    body,
    organizationId: "org_1",
    header: vi.fn((name: string) =>
      name.toLowerCase() === "idempotency-key" ? idempotencyKey : undefined
    )
  } as unknown as Request;
}

const validBody = {
  to: "person@example.com",
  subject: "Receipt",
  html: "<p>Thanks</p>"
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(transactionalEmailService.send).mockResolvedValue({
    id: "job_1",
    status: "QUEUED"
  } as never);
});

describe("transactionalEmailController.send", () => {
  it("queues the send and responds 202 with the job envelope", async () => {
    const res = mockRes();

    await transactionalEmailController.send(mockReq(validBody), res);

    expect(transactionalEmailService.send).toHaveBeenCalledWith({
      ...validBody,
      // organizationId comes from the API key / session, never the body.
      organizationId: "org_1",
      idempotencyKey: undefined
    });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      data: { id: "job_1", status: "QUEUED" }
    });
  });

  it("forwards a trimmed Idempotency-Key to the service", async () => {
    await transactionalEmailController.send(
      mockReq(validBody, "  key-abc123  "),
      mockRes()
    );

    expect(transactionalEmailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "key-abc123" })
    );
  });

  // A whitespace-only header is treated as absent, not as the empty-string key.
  it("treats a blank Idempotency-Key as absent", async () => {
    await transactionalEmailController.send(mockReq(validBody, "   "), mockRes());

    expect(transactionalEmailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: undefined })
    );
  });

  it("accepts an Idempotency-Key at the 255-character limit", async () => {
    const key = "k".repeat(255);

    await transactionalEmailController.send(mockReq(validBody, key), mockRes());

    expect(transactionalEmailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: key })
    );
  });

  it("rejects an over-long Idempotency-Key before reaching the service", async () => {
    await expect(
      transactionalEmailController.send(
        mockReq(validBody, "k".repeat(256)),
        mockRes()
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "validation_error",
      message: "Idempotency-Key must be at most 255 characters"
    });
    expect(transactionalEmailService.send).not.toHaveBeenCalled();
  });

  it("rejects an invalid body before the idempotency check", async () => {
    await expect(
      transactionalEmailController.send(
        mockReq({ to: "not-an-email" }, "k".repeat(256)),
        mockRes()
      )
    ).rejects.toThrow();
    expect(transactionalEmailService.send).not.toHaveBeenCalled();
  });

  it("ignores an organizationId supplied in the body", async () => {
    await transactionalEmailController.send(
      mockReq({ ...validBody, organizationId: "org_attacker" }),
      mockRes()
    );

    expect(transactionalEmailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1" })
    );
  });
});
