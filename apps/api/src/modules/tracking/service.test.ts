import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";

const redis = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("../../lib/redis.js", () => ({ redis }));

const webhooks = vi.hoisted(() => ({
  enqueueForEmailEvent: vi.fn(),
  enqueueLatestForEmailEvent: vi.fn()
}));
vi.mock("../webhooks/service.js", () => ({
  webhookEndpointService: webhooks
}));

const { trackingService } = await import("./service.js");

const job = { id: "job_1", organizationId: "org_1", toEmail: "x@y.com" };

/*
  A send far enough in the past that timing alone can't mark an open as a
  machine pre-fetch — so a test about User-Agents is only about User-Agents.
*/
const SENT_LONG_AGO = new Date(Date.now() - 60 * 60 * 1000);

const MAC_MAIL =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

/** A human open: a real client, long after the send, webhook slot free. */
function humanOpenSetup() {
  prismaMock.emailJob.findUnique.mockResolvedValue({
    ...job,
    sentAt: SENT_LONG_AGO
  } as never);
  prismaMock.emailEvent.create.mockResolvedValue({ id: "e1" } as never);
  redis.set.mockResolvedValue("OK");
}

function openMetadata() {
  return prismaMock.emailEvent.create.mock.calls[0][0].data.metadata as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("trackingService.recordOpen", () => {
  it("does nothing when the email job is unknown", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(null);
    await trackingService.recordOpen("missing");
    expect(prismaMock.emailEvent.create).not.toHaveBeenCalled();
  });

  it("records OPENED and never claims delivery", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...job,
      sentAt: SENT_LONG_AGO
    } as never);
    prismaMock.emailEvent.create.mockResolvedValue({ id: "e1" } as never);
    redis.set.mockResolvedValue("OK");

    await trackingService.recordOpen("job_1", { userAgent: MAC_MAIL });

    const created = prismaMock.emailEvent.create.mock.calls.map(
      (call) => (call[0].data as { type: string }).type
    );
    // An open used to synthesize a DELIVERED alongside itself. With no ESP
    // webhook that made the open pixel the sole author of every DELIVERED row,
    // so "delivery rate" on the dashboard was the open rate renamed.
    expect(created).toEqual(["OPENED"]);
    expect(created).not.toContain("DELIVERED");
  });

  it("records an open every time, not only the first", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...job,
      sentAt: SENT_LONG_AGO
    } as never);
    prismaMock.emailEvent.create.mockResolvedValue({ id: "e1" } as never);
    redis.set.mockResolvedValue("OK");

    await trackingService.recordOpen("job_1", { userAgent: MAC_MAIL });
    await trackingService.recordOpen("job_1");

    // Reporting dedupes to distinct jobs, so the raw log stays complete.
    expect(prismaMock.emailEvent.create).toHaveBeenCalledTimes(2);
    const created = prismaMock.emailEvent.create.mock.calls.map(
      (call) => (call[0].data as { type: string }).type
    );
    expect(created).toEqual(["OPENED", "OPENED"]);
  });
});

describe("trackingService.recordOpen classification", () => {
  it("stores the evidence it judged the open on, not just the verdict", async () => {
    humanOpenSetup();

    await trackingService.recordOpen("job_1", {
      userAgent: MAC_MAIL,
      ip: "203.0.113.7"
    });

    // The heuristics will change; a row that kept only "automated: true" could
    // never be re-examined against the facts it was decided from.
    expect(openMetadata()).toMatchObject({
      userAgent: MAC_MAIL,
      ip: "203.0.113.7",
      secondsSinceSent: 3600
    });
    expect(openMetadata().automated).toBeUndefined();
  });

  it("truncates a hostile User-Agent rather than storing it whole", async () => {
    humanOpenSetup();

    await trackingService.recordOpen("job_1", { userAgent: "M".repeat(5_000) });

    expect((openMetadata().userAgent as string).length).toBe(256);
  });

  it("marks a scanner's fetch automated and tells no webhook about it", async () => {
    humanOpenSetup();

    await trackingService.recordOpen("job_1", {
      userAgent: "Proofpoint-Urldefense/1.0"
    });

    expect(openMetadata()).toMatchObject({
      automated: true,
      automatedReason: "scanner"
    });
    // A security appliance opening the mail is not engagement, and telling a
    // subscriber it was "opened" is a false signal they would act on.
    expect(webhooks.enqueueForEmailEvent).not.toHaveBeenCalled();
  });

  it("marks a fetch arriving seconds after the send as a pre-fetch", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...job,
      sentAt: new Date(Date.now() - 2_000)
    } as never);
    prismaMock.emailEvent.create.mockResolvedValue({ id: "e1" } as never);

    await trackingService.recordOpen("job_1", { userAgent: MAC_MAIL });

    expect(openMetadata()).toMatchObject({
      automated: true,
      automatedReason: "prefetch"
    });
    expect(webhooks.enqueueForEmailEvent).not.toHaveBeenCalled();
  });

  it("still records the open it refuses to notify anyone about", async () => {
    humanOpenSetup();

    await trackingService.recordOpen("job_1", { userAgent: "curl/8.4.0" });

    // Classification annotates the log; it never shortens it.
    expect(prismaMock.emailEvent.create).toHaveBeenCalledTimes(1);
  });
});

describe("trackingService.recordOpen webhook debounce", () => {
  it("emits for the first human open of a job", async () => {
    humanOpenSetup();

    await trackingService.recordOpen("job_1", { userAgent: MAC_MAIL });

    expect(redis.set).toHaveBeenCalledWith(
      "open-webhook:job_1",
      "1",
      "EX",
      3600,
      "NX"
    );
    // The event just created — not "whichever OPENED row sorts newest", which
    // is ambiguous the moment two opens share a millisecond.
    expect(webhooks.enqueueForEmailEvent).toHaveBeenCalledWith("e1");
  });

  it("stays quiet for the rest of the window", async () => {
    humanOpenSetup();
    // SET NX loses: another open already claimed this job's slot.
    redis.set.mockResolvedValue(null);

    await trackingService.recordOpen("job_1", { userAgent: MAC_MAIL });

    expect(prismaMock.emailEvent.create).toHaveBeenCalledTimes(1);
    expect(webhooks.enqueueForEmailEvent).not.toHaveBeenCalled();
  });

  it("fails open when Redis is unreachable", async () => {
    humanOpenSetup();
    redis.set.mockRejectedValue(new Error("ECONNREFUSED"));

    await trackingService.recordOpen("job_1", { userAgent: MAC_MAIL });

    // Better a duplicate webhook than the only notice of an open going missing.
    expect(webhooks.enqueueForEmailEvent).toHaveBeenCalledWith("e1");
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
