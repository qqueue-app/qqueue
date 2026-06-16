import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { trackingService } from "./service.js";

const job = { id: "job_1", organizationId: "org_1", toEmail: "x@y.com" };

describe("trackingService.recordOpen", () => {
  it("does nothing when the email job is unknown", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(null);
    await trackingService.recordOpen("missing");
    expect(prismaMock.emailEvent.createMany).not.toHaveBeenCalled();
  });

  it("records DELIVERED and OPENED on the first open", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(job as never);
    prismaMock.emailEvent.findFirst.mockResolvedValue(null);
    prismaMock.emailEvent.createMany.mockResolvedValue({ count: 2 } as never);

    await trackingService.recordOpen("job_1");
    const data = prismaMock.emailEvent.createMany.mock.calls[0][0].data as Array<{
      type: string;
    }>;
    expect(data.map((d) => d.type)).toEqual(["DELIVERED", "OPENED"]);
  });

  it("records only OPENED when already delivered", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(job as never);
    prismaMock.emailEvent.findFirst.mockResolvedValue({ id: "d1" } as never);
    prismaMock.emailEvent.createMany.mockResolvedValue({ count: 1 } as never);

    await trackingService.recordOpen("job_1");
    const data = prismaMock.emailEvent.createMany.mock.calls[0][0].data as Array<{
      type: string;
    }>;
    expect(data.map((d) => d.type)).toEqual(["OPENED"]);
  });
});

describe("trackingService.recordClick", () => {
  it("does nothing when the email job is unknown", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(null);
    await trackingService.recordClick("missing", "https://x.com");
    expect(prismaMock.emailEvent.create).not.toHaveBeenCalled();
  });

  it("records a CLICKED event with the url metadata", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(job as never);
    prismaMock.emailEvent.create.mockResolvedValue({ id: "e1" } as never);
    await trackingService.recordClick("job_1", "https://x.com");
    const data = prismaMock.emailEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ type: "CLICKED", metadata: { url: "https://x.com" } });
  });
});

describe("trackingService.recordWebhookEvent", () => {
  it("returns false when no job matches by emailJobId", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(null);
    const result = await trackingService.recordWebhookEvent({
      type: "DELIVERED",
      emailJobId: "missing"
    });
    expect(result).toBe(false);
  });

  it("returns false when neither emailJobId nor messageId is provided", async () => {
    const result = await trackingService.recordWebhookEvent({ type: "DELIVERED" });
    expect(result).toBe(false);
  });

  it("records a DELIVERED event found by messageId without marking the contact", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue(job as never);
    prismaMock.emailEvent.create.mockResolvedValue({ id: "e1" } as never);
    const result = await trackingService.recordWebhookEvent({
      type: "DELIVERED",
      messageId: "msg_1"
    });
    expect(result).toBe(true);
    expect(prismaMock.contact.updateMany).not.toHaveBeenCalled();
    const data = prismaMock.emailEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ type: "DELIVERED", metadata: { source: "webhook", messageId: "msg_1" } });
  });

  it("suppresses immediately on a hard bounce", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(job as never);
    prismaMock.emailEvent.create.mockResolvedValue({ id: "e1" } as never);
    prismaMock.contact.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.suppression.upsert.mockResolvedValue({ id: "s1" } as never);
    const result = await trackingService.recordWebhookEvent({
      type: "BOUNCED",
      emailJobId: "job_1",
      email: "bounced@y.com",
      reason: "550 5.1.1 No such user"
    });
    expect(result).toBe(true);
    expect(prismaMock.contact.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", email: "bounced@y.com" },
      data: { status: "BOUNCED" }
    });
    const suppress = prismaMock.suppression.upsert.mock.calls[0][0];
    expect(suppress.create).toMatchObject({
      organizationId: "org_1",
      email: "bounced@y.com",
      reason: "BOUNCE",
      source: "webhook"
    });
    // A hard bounce suppresses without counting prior soft bounces.
    expect(prismaMock.emailEvent.count).not.toHaveBeenCalled();
    const data = prismaMock.emailEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      metadata: { source: "webhook", reason: "550 5.1.1 No such user", bounceType: "HARD" }
    });
  });

  it("does not suppress a soft bounce below the threshold", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(job as never);
    prismaMock.emailEvent.create.mockResolvedValue({ id: "e1" } as never);
    prismaMock.suppressionPolicy.findUnique.mockResolvedValue(null as never);
    prismaMock.emailEvent.count.mockResolvedValue(1 as never); // below default 3
    const result = await trackingService.recordWebhookEvent({
      type: "BOUNCED",
      emailJobId: "job_1",
      email: "soft@y.com",
      reason: "452 4.2.2 Mailbox full, over quota"
    });
    expect(result).toBe(true);
    expect(prismaMock.suppression.upsert).not.toHaveBeenCalled();
    expect(prismaMock.contact.updateMany).not.toHaveBeenCalled();
    const data = prismaMock.emailEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ metadata: { bounceType: "SOFT" } });
  });

  it("suppresses a soft bounce once the threshold is reached", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(job as never);
    prismaMock.emailEvent.create.mockResolvedValue({ id: "e1" } as never);
    prismaMock.suppressionPolicy.findUnique.mockResolvedValue(null as never);
    prismaMock.contact.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.suppression.upsert.mockResolvedValue({ id: "s1" } as never);
    prismaMock.emailEvent.count.mockResolvedValue(3 as never); // at default 3
    await trackingService.recordWebhookEvent({
      type: "BOUNCED",
      emailJobId: "job_1",
      email: "soft@y.com",
      reason: "452 4.2.2 Mailbox full, over quota"
    });
    expect(prismaMock.suppression.upsert.mock.calls[0][0].create).toMatchObject({
      reason: "BOUNCE"
    });
  });

  it("honors an explicit provider bounceType over the reason text", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(job as never);
    prismaMock.emailEvent.create.mockResolvedValue({ id: "e1" } as never);
    prismaMock.contact.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.suppression.upsert.mockResolvedValue({ id: "s1" } as never);
    // Reason text alone looks soft, but the ESP labeled it a hard bounce.
    await trackingService.recordWebhookEvent({
      type: "BOUNCED",
      emailJobId: "job_1",
      email: "hard@y.com",
      reason: "mailbox full",
      bounceType: "HARD"
    });
    expect(prismaMock.emailEvent.count).not.toHaveBeenCalled();
    expect(prismaMock.suppression.upsert).toHaveBeenCalled();
  });

  it("suppresses with COMPLAINT and the job toEmail on a complaint without an email", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(job as never);
    prismaMock.emailEvent.create.mockResolvedValue({ id: "e1" } as never);
    prismaMock.contact.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.suppression.upsert.mockResolvedValue({ id: "s1" } as never);
    await trackingService.recordWebhookEvent({
      type: "COMPLAINED",
      emailJobId: "job_1"
    });
    expect(prismaMock.contact.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", email: "x@y.com" },
      data: { status: "BOUNCED" }
    });
    expect(prismaMock.suppression.upsert.mock.calls[0][0].create).toMatchObject({
      email: "x@y.com",
      reason: "COMPLAINT"
    });
  });

  it("does not suppress on a DELIVERED webhook", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(job as never);
    prismaMock.emailEvent.create.mockResolvedValue({ id: "e1" } as never);
    await trackingService.recordWebhookEvent({
      type: "DELIVERED",
      emailJobId: "job_1"
    });
    expect(prismaMock.suppression.upsert).not.toHaveBeenCalled();
  });
});
