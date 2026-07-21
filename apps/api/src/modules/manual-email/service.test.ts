import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";

const send = vi.fn();
vi.mock("../transactional-email/service.js", () => ({
  transactionalEmailService: { send }
}));

const renderHtmlAsEmailSafe = vi.hoisted(() => vi.fn());
vi.mock("@qqueue/email-engine", () => ({
  renderHtmlAsEmailSafe,
  injectTracking: vi.fn((html?: string) =>
    html === undefined ? undefined : `${html}<pixel>`
  )
}));

const { manualEmailService } = await import("./service.js");

beforeEach(() => {
  send.mockReset().mockResolvedValue({ id: "job_1", status: "SENT" });
  renderHtmlAsEmailSafe.mockReset().mockImplementation(async (html: string) => ({
    html: `<safe>${html}</safe>`,
    errors: [],
    usedFallback: false
  }));
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

  it("logs an error when MJML compilation falls back to the raw body", async () => {
    renderHtmlAsEmailSafe.mockResolvedValue({
      html: "<p>Body</p>",
      errors: ["Unexpected token"],
      usedFallback: true
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await manualEmailService.send(
      { organizationId: "org_1", to: ["a@x.com"], subject: "Hi", html: "<p>Body</p>" },
      "user_1"
    );

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("Unexpected token");
    // The send still goes out — a fallback degrades the layout, not delivery.
    expect(send.mock.calls[0][0].html).toBe("<p>Body</p>");
    spy.mockRestore();
  });

  it("warns when MJML reports validation issues but still renders", async () => {
    renderHtmlAsEmailSafe.mockResolvedValue({
      html: "<safe/>",
      errors: ["mj-raw is not allowed here"],
      usedFallback: false
    });
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await manualEmailService.send(
      { organizationId: "org_1", to: ["a@x.com"], subject: "Hi", html: "<p>Body</p>" },
      "user_1"
    );

    expect(spy.mock.calls[0][0]).toContain("mj-raw is not allowed here");
    spy.mockRestore();
  });

  // Every other test here stubs the renderer, so none of them would notice the
  // real one emitting an invisible body (the mj-raw-in-<tbody> bug). This one
  // drives the actual MJML layer through the manual send path.
  it("sends a visible body through the real MJML renderer", async () => {
    const actual =
      await vi.importActual<typeof import("@qqueue/email-engine")>(
        "@qqueue/email-engine"
      );
    renderHtmlAsEmailSafe.mockImplementation(actual.renderHtmlAsEmailSafe);

    await manualEmailService.send(
      {
        organizationId: "org_1",
        to: ["a@x.com"],
        subject: "Hi",
        html: "<p>My typed content</p>"
      },
      "user_1"
    );

    const html: string = send.mock.calls[0][0].html;
    expect(html).toContain("<p>My typed content</p>");
    // Not foster-parented out of the table into the font-size:0px column.
    expect(html).not.toMatch(/<tbody>\s*<div class="qq-body">/);
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

describe("manualEmailService.recentRecipients", () => {
  beforeEach(() => {
    manualEmailService.clearRecipientSuggestionCache();
  });

  it("flattens past sends into a deduplicated, newest-first address list", async () => {
    prismaMock.emailJob.findMany.mockResolvedValue([
      // toEmail holds the comma-joined To set for multi-recipient sends.
      { toEmail: "a@x.com, b@x.com", cc: ["c@x.com"], bcc: [] },
      { toEmail: "A@X.com", cc: [], bcc: ["d@x.com"] }
    ] as never);

    const suggestions = await manualEmailService.recentRecipients("org_1");

    expect(suggestions.map((item) => item.email)).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
      "d@x.com"
    ]);
    expect(suggestions.every((item) => item.source === "recent")).toBe(true);
    expect(prismaMock.emailJob.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: "org_1" },
      orderBy: { createdAt: "desc" }
    });
  });

  it("serves repeat reads from cache instead of rescanning", async () => {
    prismaMock.emailJob.findMany.mockResolvedValue([
      { toEmail: "a@x.com", cc: [], bcc: [] }
    ] as never);

    const first = await manualEmailService.recentRecipients("org_1");
    const second = await manualEmailService.recentRecipients("org_1");

    expect(second).toEqual(first);
    // Every composer load would otherwise scan 500 rows.
    expect(prismaMock.emailJob.findMany).toHaveBeenCalledTimes(1);
  });

  it("caches per organization rather than globally", async () => {
    prismaMock.emailJob.findMany
      .mockResolvedValueOnce([
        { toEmail: "a@org1.com", cc: [], bcc: [] }
      ] as never)
      .mockResolvedValueOnce([
        { toEmail: "b@org2.com", cc: [], bcc: [] }
      ] as never);

    const one = await manualEmailService.recentRecipients("org_1");
    const two = await manualEmailService.recentRecipients("org_2");

    // One org must never be offered another's addresses.
    expect(one.map((item) => item.email)).toEqual(["a@org1.com"]);
    expect(two.map((item) => item.email)).toEqual(["b@org2.com"]);
  });

  it("rereads once the cached list has expired", async () => {
    vi.useFakeTimers();
    try {
      prismaMock.emailJob.findMany.mockResolvedValue([
        { toEmail: "a@x.com", cc: [], bcc: [] }
      ] as never);

      await manualEmailService.recentRecipients("org_1");
      vi.advanceTimersByTime(61_000);
      await manualEmailService.recentRecipients("org_1");

      expect(prismaMock.emailJob.findMany).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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
