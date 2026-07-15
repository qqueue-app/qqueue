import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "./test/prisma-mock.js";
import { createAuthTokens } from "./lib/tokens.js";

// Mirror app.test.ts: pin explicit queue stubs so the top-level dynamic import
// of app.js (which wires every queue-backed route) resolves against fully
// featured mocks, independent of the global src/test/setup.ts defaults.
const queueStub = vi.hoisted(() => () => ({
  add: vi.fn().mockResolvedValue(undefined),
  getJob: vi.fn().mockResolvedValue(undefined),
  getJobs: vi.fn().mockResolvedValue([]),
  getJobCounts: vi.fn().mockResolvedValue({}),
  upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
  removeJobScheduler: vi.fn().mockResolvedValue(undefined)
}));
vi.mock("./queues/email-sending.queue.js", () => ({
  emailSendingQueue: queueStub()
}));
vi.mock("./queues/campaign-processing.queue.js", () => ({
  campaignProcessingQueue: queueStub()
}));
vi.mock("./queues/webhook-delivery.queue.js", () => ({
  webhookDeliveryQueue: queueStub()
}));

// instance-settings env-status probes Redis; stub ping so the health check
// resolves instantly without a real server. (rate-limit skips Redis under
// NODE_ENV=test, so ping is the only method exercised here.)
vi.mock("./lib/redis.js", () => ({
  redis: { ping: vi.fn().mockResolvedValue("PONG") }
}));

const { createApp } = await import("./app.js");
const { invalidateInstanceSettingsCache } = await import(
  "./lib/instance-settings.js"
);

const app = createApp();
const { accessToken } = createAuthTokens({ id: "user_1", email: "a@b.com" });
const auth = `Bearer ${accessToken}`;

beforeEach(() => {
  // The instance-settings store caches for 10s; clear it so each test sees the
  // rows it stubs. Default to an empty table (all settings fall back to default).
  invalidateInstanceSettingsCache();
  prismaMock.instanceSetting.findMany.mockResolvedValue([] as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("setup routes", () => {
  it("GET /setup/status reports a fresh install (public, no auth)", async () => {
    prismaMock.user.count.mockResolvedValue(0 as never);

    const res = await request(app).get("/api/v1/setup/status");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      needsSetup: true,
      setupCompleted: false,
      // bootstrap exception: registration is open while there are zero users
      allowPublicRegistration: true
    });
  });

  it("POST /setup/complete records the admin's choice (201)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isInstanceAdmin: true
    } as never);
    prismaMock.instanceSetting.upsert.mockResolvedValue({} as never);

    const res = await request(app)
      .post("/api/v1/setup/complete")
      .set("Authorization", auth)
      .send({ allowPublicRegistration: false });

    expect(res.status).toBe(201);
    expect(res.body.data.setupCompletedAt).toEqual(expect.any(String));
    expect(prismaMock.instanceSetting.upsert).toHaveBeenCalled();
  });

  it("POST /setup/complete returns 401 without a token", async () => {
    const res = await request(app)
      .post("/api/v1/setup/complete")
      .send({ allowPublicRegistration: true });
    expect(res.status).toBe(401);
  });

  it("POST /setup/complete returns 400 for an invalid body", async () => {
    const res = await request(app)
      .post("/api/v1/setup/complete")
      .set("Authorization", auth)
      .send({ allowPublicRegistration: "yes" });
    expect(res.status).toBe(400);
  });
});

describe("instance-settings routes (instance admin only)", () => {
  it("GET / returns the current settings", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isInstanceAdmin: true
    } as never);

    const res = await request(app)
      .get("/api/v1/instance-settings")
      .set("Authorization", auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      allowPublicRegistration: true,
      setupCompletedAt: null
    });
  });

  it("PATCH / updates a setting and echoes the result", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isInstanceAdmin: true
    } as never);
    prismaMock.instanceSetting.upsert.mockResolvedValue({} as never);

    const res = await request(app)
      .patch("/api/v1/instance-settings")
      .set("Authorization", auth)
      .send({ allowPublicRegistration: false });

    expect(res.status).toBe(200);
    expect(prismaMock.instanceSetting.upsert).toHaveBeenCalled();
    expect(res.body.data).toHaveProperty("allowPublicRegistration");
  });

  it("GET /env-status reports infra health", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isInstanceAdmin: true
    } as never);

    const res = await request(app)
      .get("/api/v1/instance-settings/env-status")
      .set("Authorization", auth);

    expect(res.status).toBe(200);
    expect(res.body.data.database).toEqual({ ok: true });
    expect(res.body.data.redis.ok).toBe(true);
    expect(res.body.data).toHaveProperty("tunables");
  });

  it("returns 403 for a non-admin user", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isInstanceAdmin: false
    } as never);

    const res = await request(app)
      .get("/api/v1/instance-settings")
      .set("Authorization", auth);

    expect(res.status).toBe(403);
  });
});
