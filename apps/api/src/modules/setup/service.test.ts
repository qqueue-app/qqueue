import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";

const { setupService } = await import("./service.js");
const { invalidateInstanceSettingsCache } = await import(
  "../../lib/instance-settings.js"
);

const now = new Date("2026-01-01T00:00:00.000Z");

beforeEach(() => {
  invalidateInstanceSettingsCache();
});

describe("setupService.status", () => {
  it("needs setup on a fresh install and treats registration as open", async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.instanceSetting.findMany.mockResolvedValue([
      // Even a (stale) closed flag must not lock a zero-user instance out.
      { key: "allowPublicRegistration", value: false, updatedAt: now }
    ] as never);

    await expect(setupService.status()).resolves.toEqual({
      needsSetup: true,
      setupCompleted: false,
      allowPublicRegistration: true
    });
  });

  it("reports a finished install", async () => {
    prismaMock.user.count.mockResolvedValue(3);
    prismaMock.instanceSetting.findMany.mockResolvedValue([
      { key: "allowPublicRegistration", value: false, updatedAt: now },
      {
        key: "setupCompletedAt",
        value: "2026-01-01T00:00:00.000Z",
        updatedAt: now
      }
    ] as never);

    await expect(setupService.status()).resolves.toEqual({
      needsSetup: false,
      setupCompleted: true,
      allowPublicRegistration: false
    });
  });

  it("reports an existing pre-onboarding install as not needing setup", async () => {
    prismaMock.user.count.mockResolvedValue(2);
    prismaMock.instanceSetting.findMany.mockResolvedValue([] as never);

    await expect(setupService.status()).resolves.toEqual({
      needsSetup: false,
      setupCompleted: false,
      allowPublicRegistration: true
    });
  });
});

describe("setupService.complete", () => {
  it("rejects non-instance-admins", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isInstanceAdmin: false
    } as never);

    await expect(
      setupService.complete("user_1", { allowPublicRegistration: false })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects when setup is already complete", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isInstanceAdmin: true
    } as never);
    prismaMock.instanceSetting.findMany.mockResolvedValue([
      {
        key: "setupCompletedAt",
        value: "2026-01-01T00:00:00.000Z",
        updatedAt: now
      }
    ] as never);

    await expect(
      setupService.complete("user_1", { allowPublicRegistration: true })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("records the policy choice and the completion timestamp", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isInstanceAdmin: true
    } as never);
    prismaMock.instanceSetting.findMany.mockResolvedValue([] as never);

    const result = await setupService.complete("user_1", {
      allowPublicRegistration: false
    });

    expect(result.setupCompletedAt).toEqual(expect.any(String));
    expect(prismaMock.instanceSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "allowPublicRegistration" },
        create: { key: "allowPublicRegistration", value: false }
      })
    );
    expect(prismaMock.instanceSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "setupCompletedAt" }
      })
    );
  });
});
