import type { Request, Response } from "express";
import { signUnsubscribeToken } from "@qqueue/email-engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: verify the token, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract without re-testing service behaviour.
vi.mock("./service.js", () => ({
  unsubscribeService: { unsubscribe: vi.fn() }
}));

const { unsubscribeController } = await import("./controller.js");
const { unsubscribeService } = await import("./service.js");

const SECRET = "test-tracking-secret";

function mockRes() {
  const res = {} as Response;
  res.set = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function mockReq(query: Record<string, unknown>) {
  return { query } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(unsubscribeService.unsubscribe).mockResolvedValue(undefined);
});

describe("unsubscribeController.get", () => {
  it("renders a confirmation page WITHOUT unsubscribing", async () => {
    // GET links are prefetched by mail clients and scanners; the mutation
    // lives on POST only. The page's form posts back with the same token.
    const token = signUnsubscribeToken(
      { o: "org_1", e: "person@example.com" },
      SECRET
    );
    const res = mockRes();

    await unsubscribeController.get(mockReq({ token }), res);

    expect(unsubscribeService.unsubscribe).not.toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith(
      "Content-Type",
      "text/html; charset=utf-8"
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const html = vi.mocked(res.send).mock.calls[0]?.[0] as string;
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("person@example.com");
    expect(html).toContain('method="POST"');
    expect(html).toContain(
      `action="/api/v1/unsubscribe?token=${encodeURIComponent(token)}"`
    );
  });

  it("rejects a forged token with a plain-text 400", async () => {
    const res = mockRes();

    await unsubscribeController.get(mockReq({ token: "forged.token" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith("Invalid or expired unsubscribe link");
    expect(unsubscribeService.unsubscribe).not.toHaveBeenCalled();
  });

  it("rejects a missing token", async () => {
    const res = mockRes();

    await unsubscribeController.get(mockReq({}), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(unsubscribeService.unsubscribe).not.toHaveBeenCalled();
  });

  // Express gives an array for a repeated ?token= param; only a string is a token.
  it("rejects a non-string token", async () => {
    const res = mockRes();

    await unsubscribeController.get(mockReq({ token: ["a", "b"] }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(unsubscribeService.unsubscribe).not.toHaveBeenCalled();
  });

  it("rejects a validly-signed token missing the email", async () => {
    const token = signUnsubscribeToken({ o: "org_1", e: "" }, SECRET);
    const res = mockRes();

    await unsubscribeController.get(mockReq({ token }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(unsubscribeService.unsubscribe).not.toHaveBeenCalled();
  });

  it("rejects a validly-signed token missing the organization", async () => {
    const token = signUnsubscribeToken({ o: "", e: "person@example.com" }, SECRET);
    const res = mockRes();

    await unsubscribeController.get(mockReq({ token }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(unsubscribeService.unsubscribe).not.toHaveBeenCalled();
  });
});

describe("unsubscribeController.post", () => {
  // Reached by the RFC 8058 one-click POST (client ignores the body) and by
  // the confirmation page's form submit (renders the body).
  it("unsubscribes and renders the confirmation page", async () => {
    const token = signUnsubscribeToken(
      { o: "org_1", e: "person@example.com" },
      SECRET
    );
    const res = mockRes();

    await unsubscribeController.post(mockReq({ token }), res);

    expect(unsubscribeService.unsubscribe).toHaveBeenCalledWith(
      "org_1",
      "person@example.com"
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const html = vi.mocked(res.send).mock.calls[0]?.[0] as string;
    expect(html).toContain("You're unsubscribed");
    expect(html).toContain("person@example.com");
  });

  it("rejects a forged token with a 400", async () => {
    const res = mockRes();

    await unsubscribeController.post(mockReq({ token: "forged.token" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith("Invalid or expired unsubscribe link");
    expect(unsubscribeService.unsubscribe).not.toHaveBeenCalled();
  });

  it("rejects a missing token", async () => {
    const res = mockRes();

    await unsubscribeController.post(mockReq({}), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(unsubscribeService.unsubscribe).not.toHaveBeenCalled();
  });

  it("rejects a non-string token", async () => {
    const res = mockRes();

    await unsubscribeController.post(mockReq({ token: 42 }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects a validly-signed token missing the email", async () => {
    const token = signUnsubscribeToken({ o: "org_1", e: "" }, SECRET);
    const res = mockRes();

    await unsubscribeController.post(mockReq({ token }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(unsubscribeService.unsubscribe).not.toHaveBeenCalled();
  });

  it("rejects a validly-signed token missing the organization", async () => {
    const token = signUnsubscribeToken({ o: "", e: "person@example.com" }, SECRET);
    const res = mockRes();

    await unsubscribeController.post(mockReq({ token }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
