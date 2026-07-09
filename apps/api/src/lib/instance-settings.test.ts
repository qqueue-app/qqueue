import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";

const {
  getInstanceSettings,
  setInstanceSettings,
  invalidateInstanceSettingsCache
} = await import("./instance-settings.js");

const now = new Date("2026-01-01T00:00:00.000Z");

beforeEach(() => {
  invalidateInstanceSettingsCache();
});

describe("getInstanceSettings", () => {
  it("returns back-compat defaults when no rows exist", async () => {
    prismaMock.instanceSetting.findMany.mockResolvedValue([] as never);

    const settings = await getInstanceSettings();

    expect(settings).toEqual({
      allowPublicRegistration: true,
      setupCompletedAt: null
    });
  });

  it("returns stored values when rows exist", async () => {
    prismaMock.instanceSetting.findMany.mockResolvedValue([
      { key: "allowPublicRegistration", value: false, updatedAt: now },
      {
        key: "setupCompletedAt",
        value: "2026-01-01T00:00:00.000Z",
        updatedAt: now
      }
    ] as never);

    const settings = await getInstanceSettings();

    expect(settings).toEqual({
      allowPublicRegistration: false,
      setupCompletedAt: "2026-01-01T00:00:00.000Z"
    });
  });

  it("falls back to the default and warns on a malformed value", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    prismaMock.instanceSetting.findMany.mockResolvedValue([
      { key: "allowPublicRegistration", value: "yes-please", updatedAt: now }
    ] as never);

    const settings = await getInstanceSettings();

    expect(settings.allowPublicRegistration).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("caches reads until invalidated", async () => {
    prismaMock.instanceSetting.findMany.mockResolvedValue([] as never);

    await getInstanceSettings();
    await getInstanceSettings();
    expect(prismaMock.instanceSetting.findMany).toHaveBeenCalledTimes(1);

    invalidateInstanceSettingsCache();
    await getInstanceSettings();
    expect(prismaMock.instanceSetting.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("setInstanceSettings", () => {
  it("upserts each provided key and invalidates the cache", async () => {
    prismaMock.instanceSetting.findMany.mockResolvedValue([] as never);
    await getInstanceSettings(); // prime the cache

    await setInstanceSettings({
      allowPublicRegistration: false,
      setupCompletedAt: "2026-01-02T00:00:00.000Z"
    });

    expect(prismaMock.instanceSetting.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.instanceSetting.upsert).toHaveBeenCalledWith({
      where: { key: "allowPublicRegistration" },
      update: { value: false },
      create: { key: "allowPublicRegistration", value: false }
    });

    // Cache was invalidated: the next read hits the database again.
    await getInstanceSettings();
    expect(prismaMock.instanceSetting.findMany).toHaveBeenCalledTimes(2);
  });

  it("skips undefined values", async () => {
    await setInstanceSettings({ allowPublicRegistration: undefined });
    expect(prismaMock.instanceSetting.upsert).not.toHaveBeenCalled();
  });

  it("writes through a provided transaction client", async () => {
    await setInstanceSettings({ allowPublicRegistration: true }, prismaMock);
    expect(prismaMock.instanceSetting.upsert).toHaveBeenCalledOnce();
  });
});
