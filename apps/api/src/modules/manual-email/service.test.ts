import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";

const send = vi.fn();
vi.mock("../transactional-email/service.js", () => ({
  transactionalEmailService: { send }
}));

vi.mock("@qqueue/email-engine", () => ({
  renderHtmlAsEmailSafe: vi.fn(async (html: string) => ({
    html: `<safe>${html}</safe>`,
    errors: [],
    usedFallback: false
  })),
  injectTracking: vi.fn((html?: string) =>
    html === undefined ? undefined : `${html}<pixel>`
  )
}));

const { manualEmailService } = await import("./service.js");

beforeEach(() => {
  send.mockReset().mockResolvedValue({ id: "job_1", status: "SENT" });
  prismaMock.contact.findMany.mockResolvedValue([] as never);
  prismaMock.contactListMember.findMany.mockResolvedValue([] as never);
});

describe("manualEmailService.resolveRecipients", () => {
  it("dedupes and lowercases To across manual entries and contacts", async () => {
    prismaMock.contact.findMany.mockResolvedValue([
      { email: "Alice@example.com" }
    ] as never);

    const result = await manualEmailService.resolveRecipients({
      organizationId: "org_1",
      to: ["bob@example.com", "BOB@example.com"],
      contactIds: ["c1"]
    });

    expect(result.to).toEqual(["bob@example.com", "alice@example.com"]);
    expect(result.total).toBe(2);
  });

  it("removes Cc addresses already present in To, and Bcc in To/Cc", async () => {
    const result = await manualEmailService.resolveRecipients({
      organizationId: "org_1",
      to: ["a@x.com"],
      cc: ["a@x.com", "b@x.com"],
      bcc: ["b@x.com", "c@x.com"]
    });

    expect(result.to).toEqual(["a@x.com"]);
    expect(result.cc).toEqual(["b@x.com"]);
    expect(result.bcc).toEqual(["c@x.com"]);
    expect(result.total).toBe(3);
  });

  it("expands contact-list members into recipients", async () => {
    prismaMock.contactListMember.findMany.mockResolvedValue([
      { contactId: "c1" },
      { contactId: "c2" }
    ] as never);
    prismaMock.contact.findMany.mockResolvedValue([
      { email: "one@x.com" },
      { email: "two@x.com" }
    ] as never);

    const result = await manualEmailService.resolveRecipients({
      organizationId: "org_1",
      listIds: ["list_1"]
    });

    expect(prismaMock.contactListMember.findMany).toHaveBeenCalledWith({
      where: {
        contactListId: { in: ["list_1"] },
        contactList: { organizationId: "org_1" }
      },
      select: { contactId: true }
    });
    expect(result.to).toEqual(["one@x.com", "two@x.com"]);
  });
});

describe("manualEmailService.send", () => {
  it("throws when no recipients resolve", async () => {
    await expect(
      manualEmailService.send(
        {
          organizationId: "org_1",
          to: [],
          subject: "Hi",
          html: "<p>Hi</p>"
        },
        "user_1"
      )
    ).rejects.toThrow("At least one recipient is required");
    expect(send).not.toHaveBeenCalled();
  });

  it("renders MJML, sets MANUAL origin + createdByUserId, and reuses the pipeline", async () => {
    const result = await manualEmailService.send(
      {
        organizationId: "org_1",
        to: ["a@x.com", "A@x.com"],
        cc: ["cc@x.com"],
        bcc: ["bcc@x.com"],
        subject: "Hello",
        html: "<p>Body</p>"
      },
      "user_1"
    );

    expect(result).toEqual({ id: "job_1", status: "SENT" });
    expect(send).toHaveBeenCalledOnce();
    const arg = send.mock.calls[0][0];
    expect(arg.origin).toBe("MANUAL");
    expect(arg.createdByUserId).toBe("user_1");
    // Deduplicated, joined To.
    expect(arg.to).toBe("a@x.com");
    expect(arg.cc).toEqual(["cc@x.com"]);
    expect(arg.bcc).toEqual(["bcc@x.com"]);
    // Body rendered through the MJML email-safe layer.
    expect(arg.html).toBe("<safe><p>Body</p></safe>");
  });

  it("joins multiple To recipients into one message", async () => {
    await manualEmailService.send(
      {
        organizationId: "org_1",
        to: ["a@x.com", "b@x.com"],
        subject: "Hi",
        html: "<p>Hi</p>"
      },
      "user_1"
    );
    expect(send.mock.calls[0][0].to).toBe("a@x.com, b@x.com");
  });

  it("passes attachmentIds through to the shared pipeline", async () => {
    await manualEmailService.send(
      {
        organizationId: "org_1",
        to: ["a@x.com"],
        subject: "Hi",
        html: "<p>Hi</p>",
        attachmentIds: ["att_1", "att_2"]
      },
      "user_1"
    );
    expect(send.mock.calls[0][0].attachmentIds).toEqual(["att_1", "att_2"]);
  });
});

describe("manualEmailService.deliveryStatus", () => {
  it("throws 404 when the job is not in the org", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue(null);
    await expect(
      manualEmailService.deliveryStatus("job_1", "org_1")
    ).rejects.toThrow("Email not found");
  });

  it("derives per-recipient status from accepted/rejected and counts events", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue({
      id: "job_1",
      status: "SENT",
      sentAt: new Date("2026-06-15T10:00:00.000Z"),
      toEmail: "a@x.com, b@x.com",
      cc: ["cc@x.com"],
      bcc: ["bcc@x.com"],
      events: [
        {
          type: "SENT",
          metadata: { accepted: ["a@x.com", "cc@x.com"], rejected: ["b@x.com"] }
        },
        { type: "OPENED", metadata: null },
        { type: "OPENED", metadata: null },
        { type: "CLICKED", metadata: null }
      ]
    } as never);

    const result = await manualEmailService.deliveryStatus("job_1", "org_1");

    expect(result.sentAt).toBe("2026-06-15T10:00:00.000Z");
    expect(result.recipients).toEqual([
      { email: "a@x.com", field: "to", status: "delivered" },
      { email: "b@x.com", field: "to", status: "rejected" },
      { email: "cc@x.com", field: "cc", status: "delivered" },
      { email: "bcc@x.com", field: "bcc", status: "pending" }
    ]);
    expect(result.opens).toBe(2);
    expect(result.clicks).toBe(1);
    expect(result.bounces).toBe(0);
  });

  it("marks all recipients failed when the job failed with no SMTP result", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue({
      id: "job_1",
      status: "FAILED",
      sentAt: null,
      toEmail: "a@x.com",
      cc: [],
      bcc: [],
      events: [{ type: "FAILED", metadata: { message: "boom" } }]
    } as never);

    const result = await manualEmailService.deliveryStatus("job_1", "org_1");

    expect(result.sentAt).toBeNull();
    expect(result.recipients).toEqual([
      { email: "a@x.com", field: "to", status: "failed" }
    ]);
  });
});

describe("manualEmailService.preview", () => {
  it("renders the body through MJML + tracking and summarizes recipients", async () => {
    prismaMock.contact.findMany.mockResolvedValue([] as never);
    const result = await manualEmailService.preview({
      organizationId: "org_1",
      subject: "Subject",
      html: "<p>Hi</p>",
      to: ["a@x.com", "a@x.com"]
    });

    expect(result.subject).toBe("Subject");
    expect(result.recipients.to).toEqual(["a@x.com"]);
    expect(result.recipients.total).toBe(1);
    expect(result.html).toBe("<safe><p>Hi</p></safe><pixel>");
  });

  it("returns an empty body when there is nothing to render", async () => {
    const result = await manualEmailService.preview({
      organizationId: "org_1"
    });
    expect(result.html).toBe("");
    expect(result.recipients.total).toBe(0);
  });
});
