import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { dashboardService } from "./service.js";

describe("dashboardService.summary", () => {
  it("aggregates counts, setup flags and recent activity", async () => {
    prismaMock.sMTPConnection.count.mockResolvedValue(1 as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({
      id: "smtp_1",
      name: "Primary",
      host: "smtp.example.com",
      fromEmail: "a@b.com"
    } as never);
    prismaMock.contact.count.mockResolvedValue(5 as never);
    prismaMock.template.count.mockResolvedValue(2 as never);
    prismaMock.emailJob.count
      .mockResolvedValueOnce(10 as never) // emailsToday
      .mockResolvedValueOnce(1 as never) // failedToday
      .mockResolvedValueOnce(3 as never); // processingEmails
    prismaMock.emailJob.findMany.mockResolvedValue([
      {
        id: "job_1",
        toEmail: "x@y.com",
        subject: "Hi",
        status: "SENT",
        smtpConnection: { name: "Primary" },
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        sentAt: new Date("2026-01-01T00:01:00.000Z")
      }
    ] as never);
    prismaMock.emailEvent.findMany.mockResolvedValue([
      {
        id: "evt_1",
        type: "OPENED",
        occurredAt: new Date("2026-01-01T00:02:00.000Z"),
        emailJob: { toEmail: "x@y.com", subject: "Hi" }
      }
    ] as never);

    const result = await dashboardService.summary("org_1");

    expect(result.counts).toEqual({
      smtpConnections: 1,
      contacts: 5,
      templates: 2,
      emailsToday: 10,
      failedToday: 1,
      processingEmails: 3
    });
    expect(result.setup).toEqual({
      hasSmtpConnection: true,
      hasDefaultSmtp: true,
      hasContacts: true,
      hasTemplates: true
    });
    expect(result.recentEmailJobs[0]).toMatchObject({
      id: "job_1",
      smtpConnectionName: "Primary",
      sentAt: "2026-01-01T00:01:00.000Z"
    });
    expect(result.recentEvents[0]).toMatchObject({ id: "evt_1", type: "OPENED" });
  });

  it("handles a missing default smtp and a job without smtp/sentAt", async () => {
    prismaMock.sMTPConnection.count.mockResolvedValue(0 as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);
    prismaMock.contact.count.mockResolvedValue(0 as never);
    prismaMock.template.count.mockResolvedValue(0 as never);
    prismaMock.emailJob.count.mockResolvedValue(0 as never);
    prismaMock.emailJob.findMany.mockResolvedValue([
      {
        id: "job_2",
        toEmail: "x@y.com",
        subject: "Hi",
        status: "QUEUED",
        smtpConnection: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        sentAt: null
      }
    ] as never);
    prismaMock.emailEvent.findMany.mockResolvedValue([] as never);

    const result = await dashboardService.summary("org_1");
    expect(result.setup.hasDefaultSmtp).toBe(false);
    expect(result.setup.hasSmtpConnection).toBe(false);
    expect(result.defaultSmtpConnection).toBeNull();
    expect(result.recentEmailJobs[0].smtpConnectionName).toBeNull();
    expect(result.recentEmailJobs[0].sentAt).toBeNull();
  });
});
