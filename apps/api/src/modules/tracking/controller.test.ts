import type { Request, Response } from "express";
import { signTrackingToken } from "@qqueue/email-engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: verify the token, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract without re-testing service behaviour.
//
// TRACKING_PIXEL and webhookEventSchema are values the controller reads from the
// same module, so keep the real ones — a stubbed pixel/schema would make the
// assertions meaningless.
vi.mock("./service.js", async () => {
  const actual = await vi.importActual<typeof import("./service.js")>(
    "./service.js"
  );
  return {
    ...actual,
    trackingService: {
      recordOpen: vi.fn(),
      recordClick: vi.fn(),
      recordWebhookEvent: vi.fn()
    }
  };
});

// A mutable copy of the real (vitest-config-supplied) env, so the "instance has
// no webhook secret configured" branch is reachable without hand-rolling every
// key the transitively-imported modules validate at import time.
vi.mock("../../config/env.js", async () => {
  const actual = await vi.importActual<typeof import("../../config/env.js")>(
    "../../config/env.js"
  );
  return { env: { ...actual.env } };
});

const { trackingController } = await import("./controller.js");
const { trackingService, TRACKING_PIXEL } = await import("./service.js");
const { env } = await import("../../config/env.js");
const mutableEnv = env as { WEBHOOK_SECRET?: string };

function mockRes() {
  const res = {} as Response;
  res.set = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.redirect = vi.fn().mockReturnValue(undefined as never);
  return res;
}

function mockReq(overrides: Partial<Request> & { headers?: Record<string, string> } = {}) {
  const headers = overrides.headers ?? {};
  return {
    params: {},
    body: {},
    get: vi.fn((name: string) => headers[name.toLowerCase()]),
    ...overrides
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mutableEnv.WEBHOOK_SECRET = "test-webhook-secret";
});

describe("trackingController.open", () => {
  it("records the open and returns the pixel with no-store headers", async () => {
    vi.mocked(trackingService.recordOpen).mockResolvedValue(undefined);
    const token = signTrackingToken({ j: "job_1" }, "test-tracking-secret");
    const res = mockRes();

    await trackingController.open(mockReq({ params: { token } }), res);

    expect(trackingService.recordOpen).toHaveBeenCalledWith("job_1");
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        "Content-Type": "image/gif",
        "Content-Length": String(TRACKING_PIXEL.length),
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0"
      })
    );
    expect(res.end).toHaveBeenCalledWith(TRACKING_PIXEL);
  });

  // A mangled or forged link must never break image rendering in a mail client.
  it("still returns the pixel for a forged token, without touching the service", async () => {
    const res = mockRes();

    await trackingController.open(
      mockReq({ params: { token: "not-a-real.token" } }),
      res
    );

    expect(trackingService.recordOpen).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledWith(TRACKING_PIXEL);
  });

  it("returns the pixel even when a valid token has no job id", async () => {
    const token = signTrackingToken({ j: "" }, "test-tracking-secret");
    const res = mockRes();

    await trackingController.open(mockReq({ params: { token } }), res);

    expect(trackingService.recordOpen).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledWith(TRACKING_PIXEL);
  });

  it("swallows a service failure and still returns the pixel", async () => {
    vi.mocked(trackingService.recordOpen).mockRejectedValue(new Error("db down"));
    const token = signTrackingToken({ j: "job_1" }, "test-tracking-secret");
    const res = mockRes();

    await trackingController.open(mockReq({ params: { token } }), res);

    expect(res.end).toHaveBeenCalledWith(TRACKING_PIXEL);
  });
});

describe("trackingController.click", () => {
  it("records the click and redirects to the signed destination", async () => {
    vi.mocked(trackingService.recordClick).mockResolvedValue(undefined);
    const token = signTrackingToken(
      { j: "job_1", u: "https://example.com/pricing" },
      "test-tracking-secret"
    );
    const res = mockRes();

    await trackingController.click(mockReq({ params: { token } }), res);

    expect(trackingService.recordClick).toHaveBeenCalledWith(
      "job_1",
      "https://example.com/pricing"
    );
    expect(res.redirect).toHaveBeenCalledWith(302, "https://example.com/pricing");
  });

  it("rejects a forged token with 400 rather than redirecting", async () => {
    const res = mockRes();

    await trackingController.click(
      mockReq({ params: { token: "bogus.sig" } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith("Invalid tracking link");
    expect(res.redirect).not.toHaveBeenCalled();
    expect(trackingService.recordClick).not.toHaveBeenCalled();
  });

  // Signature alone isn't enough: the scheme gate is what keeps this endpoint
  // from being usable as an open redirect / javascript: sink.
  it("refuses a validly-signed non-http(s) destination", async () => {
    const token = signTrackingToken(
      { j: "job_1", u: "javascript:alert(1)" },
      "test-tracking-secret"
    );
    const res = mockRes();

    await trackingController.click(mockReq({ params: { token } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("refuses a validly-signed token with no destination", async () => {
    const token = signTrackingToken({ j: "job_1" }, "test-tracking-secret");
    const res = mockRes();

    await trackingController.click(mockReq({ params: { token } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("swallows a service failure and still redirects", async () => {
    vi.mocked(trackingService.recordClick).mockRejectedValue(new Error("db down"));
    const token = signTrackingToken(
      { j: "job_1", u: "http://example.com" },
      "test-tracking-secret"
    );
    const res = mockRes();

    await trackingController.click(mockReq({ params: { token } }), res);

    expect(res.redirect).toHaveBeenCalledWith(302, "http://example.com");
  });
});

describe("trackingController.webhook", () => {
  const body = { type: "DELIVERED", messageId: "<msg-1@example.com>" };

  it("records a normalized event and responds 202", async () => {
    vi.mocked(trackingService.recordWebhookEvent).mockResolvedValue(true);
    const res = mockRes();

    await trackingController.webhook(
      mockReq({ body, headers: { "x-webhook-secret": "test-webhook-secret" } }),
      res
    );

    expect(trackingService.recordWebhookEvent).toHaveBeenCalledWith(body);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ data: { recorded: true } });
  });

  it("responds 404 when no email job matches the event", async () => {
    vi.mocked(trackingService.recordWebhookEvent).mockResolvedValue(false);
    const res = mockRes();

    await trackingController.webhook(
      mockReq({ body, headers: { "x-webhook-secret": "test-webhook-secret" } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: "No matching email job for webhook event" }
    });
  });

  it("rejects a wrong secret with 401 before reaching the service", async () => {
    const res = mockRes();

    await trackingController.webhook(
      mockReq({ body, headers: { "x-webhook-secret": "wrong" } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: "Invalid webhook secret" }
    });
    expect(trackingService.recordWebhookEvent).not.toHaveBeenCalled();
  });

  it("rejects a missing secret header with 401", async () => {
    const res = mockRes();

    await trackingController.webhook(mockReq({ body }), res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  // With no secret configured the endpoint stays closed, rather than accepting
  // an equally-absent header.
  it("rejects every request when the instance has no webhook secret", async () => {
    mutableEnv.WEBHOOK_SECRET = undefined;
    const res = mockRes();

    await trackingController.webhook(mockReq({ body }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(trackingService.recordWebhookEvent).not.toHaveBeenCalled();
  });

  it("rejects an invalid body once the secret checks out", async () => {
    await expect(
      trackingController.webhook(
        mockReq({
          body: { type: "EXPLODED" },
          headers: { "x-webhook-secret": "test-webhook-secret" }
        }),
        mockRes()
      )
    ).rejects.toThrow();
    expect(trackingService.recordWebhookEvent).not.toHaveBeenCalled();
  });
});
