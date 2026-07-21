import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";

const queue = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("../../queues/email-sending.queue.js", () => ({
  emailSendingQueue: queue
}));

const { outboxService } = await import("./service.js");

beforeEach(() => {
  queue.remove.mockReset();
  queue.remove.mockResolvedValue(1);
});

describe("outboxService.list", () => {
  it("returns only mail that is still on its way, soonest first", async () => {
    prismaMock.emailJob.findMany.mockResolvedValue([] as never);

    await outboxService.list("org_1");

    const args = prismaMock.emailJob.findMany.mock.calls[0][0]!;
    expect(args.where).toEqual({
      organizationId: "org_1",
      status: { in: ["PENDING", "QUEUED", "PROCESSING"] }
    });
    expect(args.orderBy).toEqual([
      { scheduledAt: "asc" },
      { createdAt: "asc" }
    ]);
  });

  it("splits the joined To set and surfaces the sending account", async () => {
    prismaMock.emailJob.findMany.mockResolvedValue([
      {
        id: "job_1",
        subject: "Launch",
        // Manual sends store the deduplicated To set comma-joined.
        toEmail: "a@x.com, b@x.com",
        cc: ["c@x.com"],
        bcc: [],
        status: "QUEUED",
        origin: "MANUAL",
        scheduledAt: new Date("2026-07-22T09:00:00.000Z"),
        createdAt: new Date("2026-07-21T09:00:00.000Z"),
        campaign: null,
        smtpConnection: {
          name: "Primary",
          fromEmail: "hi@acme.com",
          fromName: "Acme"
        }
      }
    ] as never);

    const [email] = await outboxService.list("org_1");

    expect(email.to).toEqual(["a@x.com", "b@x.com"]);
    expect(email.ccCount).toBe(1);
    expect(email.bccCount).toBe(0);
    expect(email.sendingAccount).toEqual({
      name: "Primary",
      fromEmail: "hi@acme.com",
      fromName: "Acme"
    });
    expect(email.scheduledAt).toBe("2026-07-22T09:00:00.000Z");
  });

  it("labels campaign sends with the campaign name", async () => {
    prismaMock.emailJob.findMany.mockResolvedValue([
      {
        id: "job_1",
        subject: "Newsletter",
        toEmail: "a@x.com",
        cc: [],
        bcc: [],
        status: "QUEUED",
        origin: "CAMPAIGN",
        scheduledAt: null,
        createdAt: new Date("2026-07-21T09:00:00.000Z"),
        campaign: { name: "July newsletter" },
        smtpConnection: null
      }
    ] as never);

    const [email] = await outboxService.list("org_1");

    expect(email.campaignName).toBe("July newsletter");
    expect(email.sendingAccount).toBeNull();
  });
});

describe("outboxService.cancel", () => {
  it("marks the job cancelled and drops the delayed queue job", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue({
      id: "job_1",
      status: "QUEUED"
    } as never);
    prismaMock.emailJob.update.mockResolvedValue({
      id: "job_1",
      status: "CANCELLED"
    } as never);

    const result = await outboxService.cancel("job_1", "org_1");

    expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith({
      where: { id: "job_1", organizationId: "org_1" },
      select: { id: true, status: true }
    });
    expect(prismaMock.emailJob.update).toHaveBeenCalledWith({
      where: { id: "job_1" },
      data: { status: "CANCELLED" }
    });
    // Must match the jobId both enqueue sites use.
    expect(queue.remove).toHaveBeenCalledWith("email-job_1");
    expect(result).toEqual({ id: "job_1", status: "CANCELLED" });
  });

  it("still cancels when the queue job is already gone", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue({
      id: "job_1",
      status: "PENDING"
    } as never);
    prismaMock.emailJob.update.mockResolvedValue({
      id: "job_1",
      status: "CANCELLED"
    } as never);
    queue.remove.mockRejectedValue(new Error("job is locked"));

    // Postgres is the source of truth: the send worker re-reads the row and
    // skips CANCELLED jobs, so a failed removal is not an error.
    await expect(outboxService.cancel("job_1", "org_1")).resolves.toEqual({
      id: "job_1",
      status: "CANCELLED"
    });
  });

  it("404s for an email in another organization", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue(null as never);

    await expect(outboxService.cancel("job_1", "org_1")).rejects.toThrow(
      new HttpError(404, "Email not found", "not_found")
    );
    expect(prismaMock.emailJob.update).not.toHaveBeenCalled();
  });

  it.each([
    ["SENT", "This email has already been sent"],
    ["PROCESSING", "This email is already being sent"]
  ])("refuses to cancel a %s email", async (status, message) => {
    prismaMock.emailJob.findFirst.mockResolvedValue({
      id: "job_1",
      status
    } as never);

    await expect(outboxService.cancel("job_1", "org_1")).rejects.toThrow(
      new HttpError(409, message, "conflict")
    );
    expect(queue.remove).not.toHaveBeenCalled();
  });
});
