import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";

const redisPing = vi.fn();
vi.mock("../../lib/redis.js", () => ({
  redis: { ping: redisPing }
}));

const { instanceSettingsService } = await import("./service.js");
const { invalidateInstanceSettingsCache } = await import(
  "../../lib/instance-settings.js"
);

const now = new Date("2026-01-01T00:00:00.000Z");

beforeEach(() => {
  invalidateInstanceSettingsCache();
  redisPing.mockReset();
});

describe("instanceSettingsService.get / update", () => {
  it("returns the current settings", async () => {
    prismaMock.instanceSetting.findMany.mockResolvedValue([
      { key: "allowPublicRegistration", value: false, updatedAt: now }
    ] as never);

    await expect(instanceSettingsService.get()).resolves.toEqual({
      allowPublicRegistration: false,
      setupCompletedAt: null
    });
  });

  it("writes updates and returns the fresh values", async () => {
    prismaMock.instanceSetting.findMany.mockResolvedValue([
      { key: "allowPublicRegistration", value: true, updatedAt: now }
    ] as never);

    const result = await instanceSettingsService.update({
      allowPublicRegistration: true
    });

    expect(prismaMock.instanceSetting.upsert).toHaveBeenCalledWith({
      where: { key: "allowPublicRegistration" },
      update: { value: true },
      create: { key: "allowPublicRegistration", value: true }
    });
    expect(result.allowPublicRegistration).toBe(true);
  });
});

describe("instanceSettingsService.envStatus", () => {
  it("reports healthy database and redis", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ "?column?": 1 }] as never);
    redisPing.mockResolvedValue("PONG");

    const status = await instanceSettingsService.envStatus();

    expect(status.database.ok).toBe(true);
    expect(status.redis.ok).toBe(true);
    expect(status.storage.bucket).toEqual(expect.any(String));
    expect(status.urls.appUrl).toEqual(expect.any(String));
    expect(status.tunables.softBounceThreshold).toEqual(expect.any(Number));
  });

  it("reports failures without throwing", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("down") as never);
    redisPing.mockRejectedValue(new Error("down"));

    const status = await instanceSettingsService.envStatus();

    expect(status.database.ok).toBe(false);
    expect(status.redis.ok).toBe(false);
  });
});
