import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";

const h = vi.hoisted(() => ({
  queue: { upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn() }
}));

vi.mock("../../queues/recurring-send.queue.js", () => ({
  recurringSendQueue: h.queue,
  recurringSendSchedulerId: (id: string) => `recurring-send-${id}`
}));

const { recurringSendService } = await import("./service.js");

const baseInput = {
  organizationId: "org-1",
  name: "Weekly digest",
  subject: "Digest",
  html: "<p>hi</p>",
  to: ["a@example.com"],
  cronExpression: "0 9 * * 1",
  timezone: "UTC"
};

beforeEach(() => {
  h.queue.upsertJobScheduler.mockReset();
  h.queue.removeJobScheduler.mockReset();
});

describe("recurringSendService.create", () => {
  it("resolves the org default sending account and arms the scheduler", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({
      id: "smtp-default"
    } as never);
    prismaMock.recurringSend.create.mockResolvedValue({
      id: "rs-1",
      cronExpression: "0 9 * * 1",
      timezone: "UTC"
    } as never);

    await recurringSendService.create(baseInput as never, "user-1");

    // No explicit smtpConnectionId -> falls back to the org default.
    expect(prismaMock.sMTPConnection.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        id: undefined,
        isDefault: true
      },
      select: { id: true }
    });

    const data = prismaMock.recurringSend.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organizationId: "org-1",
      createdByUserId: "user-1",
      smtpConnectionId: "smtp-default",
      status: "ACTIVE"
    });
    // nextRunAt is computed up front so the UI can show it immediately.
    expect(data.nextRunAt).toBeInstanceOf(Date);

    expect(h.queue.upsertJobScheduler).toHaveBeenCalledWith(
      "recurring-send-rs-1",
      { pattern: "0 9 * * 1", tz: "UTC" },
      expect.objectContaining({ name: "process-recurring-send" })
    );
  });

  it("rejects when no sending account can be resolved", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null as never);

    await expect(
      recurringSendService.create(baseInput as never, "user-1")
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(prismaMock.recurringSend.create).not.toHaveBeenCalled();
    expect(h.queue.upsertJobScheduler).not.toHaveBeenCalled();
  });
});

describe("recurringSendService.pause / resume", () => {
  it("pause disarms the scheduler and clears nextRunAt", async () => {
    prismaMock.recurringSend.findFirst.mockResolvedValue({
      id: "rs-1",
      status: "ACTIVE",
      cronExpression: "0 9 * * 1",
      timezone: "UTC"
    } as never);
    prismaMock.recurringSend.update.mockResolvedValue({} as never);

    await recurringSendService.pause("rs-1", "user-1");

    expect(h.queue.removeJobScheduler).toHaveBeenCalledWith(
      "recurring-send-rs-1"
    );
    expect(prismaMock.recurringSend.update.mock.calls[0][0].data).toEqual({
      status: "PAUSED",
      nextRunAt: null
    });
  });

  it("pause is a no-op when already paused", async () => {
    prismaMock.recurringSend.findFirst.mockResolvedValue({
      id: "rs-1",
      status: "PAUSED"
    } as never);

    await recurringSendService.pause("rs-1", "user-1");

    expect(h.queue.removeJobScheduler).not.toHaveBeenCalled();
    expect(prismaMock.recurringSend.update).not.toHaveBeenCalled();
  });

  it("resume re-arms the scheduler and recomputes nextRunAt", async () => {
    prismaMock.recurringSend.findFirst.mockResolvedValue({
      id: "rs-1",
      status: "PAUSED",
      cronExpression: "0 9 * * 1",
      timezone: "UTC"
    } as never);
    prismaMock.recurringSend.update.mockResolvedValue({} as never);

    await recurringSendService.resume("rs-1", "user-1");

    expect(h.queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    const data = prismaMock.recurringSend.update.mock.calls[0][0].data;
    expect(data.status).toBe("ACTIVE");
    expect(data.nextRunAt).toBeInstanceOf(Date);
  });

  it("404s for a send outside the caller's organizations", async () => {
    prismaMock.recurringSend.findFirst.mockResolvedValue(null as never);

    await expect(
      recurringSendService.pause("rs-1", "user-1")
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("recurringSendService.delete", () => {
  it("removes the scheduler before deleting the row", async () => {
    prismaMock.recurringSend.findFirst.mockResolvedValue({
      id: "rs-1",
      status: "ACTIVE"
    } as never);
    prismaMock.recurringSend.delete.mockResolvedValue({} as never);

    await recurringSendService.delete("rs-1", "user-1");

    expect(h.queue.removeJobScheduler).toHaveBeenCalledWith(
      "recurring-send-rs-1"
    );
    expect(prismaMock.recurringSend.delete).toHaveBeenCalledWith({
      where: { id: "rs-1" }
    });
  });
});
