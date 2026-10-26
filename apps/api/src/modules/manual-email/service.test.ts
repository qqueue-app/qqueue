import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";

const send = vi.fn();
vi.mock("../transactional-email/service.js", () => ({
  transactionalEmailService: { send, enqueue: vi.fn() },
}));

const { manualEmailService } = await import("./service.js");

beforeEach(() => {
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    role: "OWNER",
  } as never);
  prismaMock.emailJob.findMany.mockResolvedValue([] as never);
  prismaMock.emailAttachment.updateMany.mockResolvedValue({
    count: 2,
  } as never);
  send.mockReset().mockResolvedValue({ id: "job_1", status: "QUEUED" });
  prismaMock.contact.findMany.mockResolvedValue([] as never);
  prismaMock.contactListMember.findMany.mockResolvedValue([] as never);
  // Default: nobody is suppressed (carrier selection queries this).
  prismaMock.suppression.findMany.mockResolvedValue([] as never);
});

describe("manualEmailService.resolveRecipients", () => {
  it("dedupes and lowercases To across manual entries and contacts", async () => {
    prismaMock.contact.findMany.mockResolvedValue([
      { email: "Alice@example.com" },
    ] as never);

    const result = await manualEmailService.resolveRecipients({
      organizationId: "org_1",
      to: ["bob@example.com", "BOB@example.com"],
      contactIds: ["c1"],
    });

    expect(result.to).toEqual(["bob@example.com", "alice@example.com"]);
    expect(result.total).toBe(2);
  });

  it("removes Cc addresses already present in To, and Bcc in To/Cc", async () => {
    const result = await manualEmailService.resolveRecipients({
      organizationId: "org_1",
      to: ["a@x.com"],
      cc: ["a@x.com", "b@x.com"],
      bcc: ["b@x.com", "c@x.com"],
    });

    expect(result.to).toEqual(["a@x.com"]);
    expect(result.cc).toEqual(["b@x.com"]);
    expect(result.bcc).toEqual(["c@x.com"]);
    expect(result.total).toBe(3);
  });

  it("expands contact-list members into recipients", async () => {
    prismaMock.contactListMember.findMany.mockResolvedValue([
      { contactId: "c1" },
      { contactId: "c2" },
    ] as never);
    prismaMock.contact.findMany.mockResolvedValue([
      { email: "one@x.com" },
      { email: "two@x.com" },
    ] as never);

    const result = await manualEmailService.resolveRecipients({
      organizationId: "org_1",
      listIds: ["list_1"],
    });

    expect(prismaMock.contactListMember.findMany).toHaveBeenCalledWith({
      where: {
        contactListId: { in: ["list_1"] },
        contactList: { organizationId: "org_1" },
      },
      select: { contactId: true },
    });
    expect(result.to).toEqual(["one@x.com", "two@x.com"]);
  });
});

describe("manualEmailService.send", () => {
  function copiedDraft() {
    const source = {
      messageId: "external1",
      version: "v1",
      reviewedVersion: "v1",
      inReplyTo: "<parent>",
      references: ["<ancestor>", "<parent>"],
    };
    prismaMock.emailDraft.findFirst.mockResolvedValue({
      id: "d1",
      revision: 4,
      mailboxDraftSource: source,
    } as never);
    prismaMock.emailAttachment.findMany.mockResolvedValue([]);
    prismaMock.emailDraft.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.inboundMessage.findFirst.mockResolvedValue({
      id: "external1",
      remoteDraftVersion: "v1",
      remoteDraftFolderId: "folder1",
      remoteDraftUid: 7,
      remoteDraftUidValidity: "99",
      bodyStatus: "AVAILABLE",
      contentImportPending: false,
      attachments: [],
      to: [],
      cc: [],
      remoteDraftBcc: [],
    } as never);
    prismaMock.inboundMessageLocation.findFirst.mockResolvedValue({
      id: "location1",
    } as never);
    return {
      organizationId: "org_1",
      draftId: "d1",
      expectedRevision: 4,
      to: ["to@example.test"],
      subject: "Copy",
      html: "<p>Private writing</p>",
    };
  }
  it("preserves the source reply chain through the existing manual pipeline", async () => {
    await manualEmailService.send(
      { ...copiedDraft(), inReplyTo: "<forged>" },
      "user_1"
    );
    expect(send.mock.calls[0][0]).toMatchObject({
      origin: "MANUAL",
      createdByUserId: "user_1",
      inReplyTo: "<parent>",
      references: ["<ancestor>", "<parent>"],
    });
  });
  it.each(["v2", null])(
    "blocks an unreviewed original change before creating jobs: %s",
    async (version) => {
      const input = copiedDraft();
      prismaMock.inboundMessage.findFirst.mockResolvedValue({
        id: "external1",
        remoteDraftVersion: version,
      } as never);
      await expect(
        manualEmailService.send(input, "user_1")
      ).rejects.toMatchObject({ code: "mailbox_draft_conflict" });
      expect(send).not.toHaveBeenCalled();
      expect(prismaMock.emailDraft.updateMany).not.toHaveBeenCalled();
    }
  );
  it("recovers an already accepted copy before checking a subsequently changed source", async () => {
    const input = copiedDraft();
    await manualEmailService.send(input, "user_1");
    const requestHash = send.mock.calls[0][0].requestHash;
    prismaMock.emailJob.findUnique.mockResolvedValue({
      id: "job_1",
      status: "QUEUED",
      requestHash,
    } as never);
    prismaMock.inboundMessage.findFirst.mockClear().mockResolvedValue(null);
    await expect(manualEmailService.send(input, "user_1")).resolves.toEqual({
      id: "job_1",
      status: "QUEUED",
    });
    expect(prismaMock.inboundMessage.findFirst).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("throws when no recipients resolve", async () => {
    await expect(
      manualEmailService.send(
        {
          organizationId: "org_1",
          to: [],
          subject: "Hi",
          html: "<p>Hi</p>",
        },
        "user_1"
      )
    ).rejects.toThrow("At least one recipient is required");
    expect(send).not.toHaveBeenCalled();
  });

  it("passes body through, sets MANUAL origin + createdByUserId, and reuses the pipeline", async () => {
    const result = await manualEmailService.send(
      {
        organizationId: "org_1",
        to: ["a@x.com", "A@x.com"],
        cc: ["cc@x.com"],
        bcc: ["bcc@x.com"],
        subject: "Hello",
        html: "<p>Body</p>",
      },
      "user_1"
    );

    expect(result).toEqual({ id: "job_1", status: "QUEUED" });
    expect(send).toHaveBeenCalledTimes(3);
    const arg = send.mock.calls[0][0];
    expect(arg.origin).toBe("MANUAL");
    expect(arg.createdByUserId).toBe("user_1");
    expect(arg.to).toBe("a@x.com");
    expect(arg.cc).toEqual([]);
    expect(arg.bcc).toEqual([]);
    // A single-recipient send needs no group.
    expect(arg.sendGroupId).toEqual(expect.any(String));
    expect(arg.html).toBe("<p>Body</p>");
  });

  it("delivers each To and Cc independently with one logical group", async () => {
    send
      .mockResolvedValueOnce({ id: "job_a", status: "QUEUED" })
      .mockResolvedValueOnce({ id: "job_b", status: "QUEUED" });

    const result = await manualEmailService.send(
      {
        organizationId: "org_1",
        to: ["a@x.com", "b@x.com"],
        cc: ["cc@x.com"],
        subject: "Hi",
        html: "<p>Hi</p>",
      },
      "user_1"
    );

    expect(send).toHaveBeenCalledTimes(3);
    const [first, second] = send.mock.calls.map((call) => call[0]);
    expect(first.to).toBe("a@x.com");
    expect(second.to).toBe("b@x.com");
    // CC rides exactly one job — one copy per copy-recipient, not one per To.
    expect(first.cc).toEqual([]);
    expect(second.cc).toEqual([]);
    // Jobs share a group so delivery status can be aggregated.
    expect(first.sendGroupId).toEqual(expect.any(String));
    expect(second.sendGroupId).toBe(first.sendGroupId);
    // The carrier job is the one the composer polls.
    expect(result).toEqual({ id: "job_a", status: "QUEUED" });
  });

  it("retains visible group headers and Message-ID across copies and retries without exposing Bcc", async () => {
    const input = {
      organizationId: "org_1",
      to: ["a@x.com", "b@x.com"],
      cc: ["copy@x.com"],
      bcc: ["private@x.com"],
      subject: "Group",
      text: "Hello",
      idempotencyKey: "draft-1",
    };
    await manualEmailService.send(input, "user_1");
    await manualEmailService.send(input, "user_1");
    const calls = send.mock.calls.map(([call]) => call);
    expect(new Set(calls.map((call) => call.messageId)).size).toBe(1);
    for (const call of calls) {
      expect(call.visibleTo).toEqual(input.to);
      expect(call.visibleCc).toEqual(input.cc);
      expect(JSON.stringify([call.visibleTo, call.visibleCc])).not.toContain(
        "private"
      );
    }
    expect(calls[0].idempotencyKey).toBe(calls[4].idempotencyKey);
    // Keep the pre-existing group-key format so interrupted sends can resume
    // across an upgrade without splitting their delivery-status group.
    expect(calls[0].sendGroupId).toBe(
      createHash("sha256").update("user_1:org_1:draft-1").digest("hex")
    );
    await manualEmailService.send(input, "user_2");
    expect(send.mock.calls[8][0].messageId).not.toBe(calls[0].messageId);
  });

  it("still delivers Cc independently when the first To is suppressed", async () => {
    // a@x.com is suppressed: copies must ride a job that will actually send.
    prismaMock.suppression.findMany.mockResolvedValue([
      { email: "a@x.com" },
    ] as never);
    send
      .mockResolvedValueOnce({ id: "job_a", status: "SUPPRESSED" })
      .mockResolvedValueOnce({ id: "job_b", status: "QUEUED" });

    const result = await manualEmailService.send(
      {
        organizationId: "org_1",
        to: ["a@x.com", "b@x.com"],
        cc: ["cc@x.com"],
        subject: "Hi",
        html: "<p>Hi</p>",
      },
      "user_1"
    );

    const [first, second] = send.mock.calls.map((call) => call[0]);
    expect(first.cc).toEqual([]);
    expect(second.cc).toEqual([]);
    expect(send.mock.calls[2][0]).toMatchObject({
      to: "cc@x.com",
      recipientField: "cc",
    });
    // The carrier (second job) is the primary the composer polls.
    expect(result).toEqual({ id: "job_a", status: "QUEUED" });
  });

  it("links attachments on the first job and copies them onto siblings", async () => {
    await manualEmailService.send(
      {
        organizationId: "org_1",
        to: ["a@x.com", "b@x.com"],
        subject: "Hi",
        html: "<p>Hi</p>",
        attachmentIds: ["att_1", "att_2"],
      },
      "user_1"
    );

    const [first, second] = send.mock.calls.map((call) => call[0]);
    expect(first.attachmentIds).toEqual(["att_1", "att_2"]);
    expect(first.attachmentMode).toBe("copy");
    expect(second.attachmentIds).toEqual(["att_1", "att_2"]);
    expect(second.attachmentMode).toBe("copy");
  });

  it("passes authored HTML through without a layout", async () => {
    await manualEmailService.send(
      {
        organizationId: "org_1",
        to: ["a@x.com"],
        subject: "Hi",
        html: "<p>My typed content</p>",
      },
      "user_1"
    );

    expect(send.mock.calls[0][0].html).toBe("<p>My typed content</p>");
  });
});

describe("manualEmailService.deliveryStatus", () => {
  it("throws 404 when the job is not in the org", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue(null);
    await expect(
      manualEmailService.deliveryStatus("job_1", "org_1", "user_1")
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
          metadata: {
            accepted: ["a@x.com", "cc@x.com"],
            rejected: ["b@x.com"],
          },
        },
        { type: "OPENED", metadata: null },
        { type: "OPENED", metadata: null },
        { type: "CLICKED", metadata: null },
      ],
    } as never);

    const result = await manualEmailService.deliveryStatus(
      "job_1",
      "org_1",
      "user_1"
    );

    expect(result.sentAt).toBe("2026-06-15T10:00:00.000Z");
    expect(result.recipients).toEqual([
      { email: "a@x.com", field: "to", status: "delivered" },
      { email: "b@x.com", field: "to", status: "rejected" },
      { email: "cc@x.com", field: "cc", status: "delivered" },
      { email: "bcc@x.com", field: "bcc", status: "pending" },
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
      events: [{ type: "FAILED", metadata: { message: "boom" } }],
    } as never);

    const result = await manualEmailService.deliveryStatus(
      "job_1",
      "org_1",
      "user_1"
    );

    expect(result.sentAt).toBeNull();
    expect(result.recipients).toEqual([
      { email: "a@x.com", field: "to", status: "failed" },
    ]);
  });

  it("aggregates a fanned-out send across its sibling jobs", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue({
      id: "job_a",
      status: "SENT",
      sentAt: new Date("2026-06-15T10:00:00.000Z"),
      toEmail: "a@x.com",
      cc: ["cc@x.com"],
      bcc: [],
      sendGroupId: "grp_1",
      createdAt: new Date("2026-06-15T09:59:00.000Z"),
      events: [],
    } as never);
    prismaMock.emailJob.findMany.mockResolvedValue([
      {
        id: "job_a",
        status: "SENT",
        sentAt: new Date("2026-06-15T10:00:00.000Z"),
        toEmail: "a@x.com",
        cc: ["cc@x.com"],
        bcc: [],
        sendGroupId: "grp_1",
        createdAt: new Date("2026-06-15T09:59:00.000Z"),
        events: [
          {
            type: "SENT",
            metadata: { accepted: ["a@x.com", "cc@x.com"], rejected: [] },
          },
          { type: "OPENED", metadata: null },
        ],
      },
      {
        id: "job_b",
        status: "SUPPRESSED",
        sentAt: null,
        toEmail: "b@x.com",
        cc: [],
        bcc: [],
        sendGroupId: "grp_1",
        createdAt: new Date("2026-06-15T09:59:01.000Z"),
        events: [],
      },
    ] as never);

    const result = await manualEmailService.deliveryStatus(
      "job_a",
      "org_1",
      "user_1"
    );

    expect(prismaMock.emailJob.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: "org_1", sendGroupId: "grp_1" },
    });
    expect(result.recipients).toEqual([
      { email: "a@x.com", field: "to", status: "delivered" },
      { email: "cc@x.com", field: "cc", status: "delivered" },
      { email: "b@x.com", field: "to", status: "suppressed" },
    ]);
    // A send happened, so the aggregate reports SENT (terminal for the poll).
    expect(result.status).toBe("SENT");
    expect(result.opens).toBe(1);
  });

  it("stays non-terminal while any sibling job is still queued", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue({
      id: "job_a",
      status: "SENT",
      sentAt: null,
      toEmail: "a@x.com",
      cc: [],
      bcc: [],
      sendGroupId: "grp_1",
      createdAt: new Date(),
      events: [],
    } as never);
    prismaMock.emailJob.findMany.mockResolvedValue([
      {
        id: "job_a",
        status: "SENT",
        sentAt: null,
        toEmail: "a@x.com",
        cc: [],
        bcc: [],
        sendGroupId: "grp_1",
        createdAt: new Date(),
        events: [],
      },
      {
        id: "job_b",
        status: "QUEUED",
        sentAt: null,
        toEmail: "b@x.com",
        cc: [],
        bcc: [],
        sendGroupId: "grp_1",
        createdAt: new Date(),
        events: [],
      },
    ] as never);

    const result = await manualEmailService.deliveryStatus(
      "job_a",
      "org_1",
      "user_1"
    );

    expect(result.status).toBe("QUEUED");
    expect(result.recipients).toContainEqual({
      email: "b@x.com",
      field: "to",
      status: "pending",
    });
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
      { toEmail: "A@X.com", cc: [], bcc: ["d@x.com"] },
    ] as never);

    const suggestions = await manualEmailService.recentRecipients(
      "org_1",
      "user_1"
    );

    expect(suggestions.map((item) => item.email)).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
      "d@x.com",
    ]);
    expect(suggestions.every((item) => item.source === "recent")).toBe(true);
    expect(prismaMock.emailJob.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: "org_1" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("serves repeat reads from cache instead of rescanning", async () => {
    prismaMock.emailJob.findMany.mockResolvedValue([
      { toEmail: "a@x.com", cc: [], bcc: [] },
    ] as never);

    const first = await manualEmailService.recentRecipients("org_1", "user_1");
    const second = await manualEmailService.recentRecipients("org_1", "user_1");

    expect(second).toEqual(first);
    // Every composer load would otherwise scan 500 rows.
    expect(prismaMock.emailJob.findMany).toHaveBeenCalledTimes(1);
  });

  it("caches per organization rather than globally", async () => {
    prismaMock.emailJob.findMany
      .mockResolvedValueOnce([
        { toEmail: "a@org1.com", cc: [], bcc: [] },
      ] as never)
      .mockResolvedValueOnce([
        { toEmail: "b@org2.com", cc: [], bcc: [] },
      ] as never);

    const one = await manualEmailService.recentRecipients("org_1", "user_1");
    const two = await manualEmailService.recentRecipients("org_2", "user_1");

    // One org must never be offered another's addresses.
    expect(one.map((item) => item.email)).toEqual(["a@org1.com"]);
    expect(two.map((item) => item.email)).toEqual(["b@org2.com"]);
  });

  it("rereads once the cached list has expired", async () => {
    vi.useFakeTimers();
    try {
      prismaMock.emailJob.findMany.mockResolvedValue([
        { toEmail: "a@x.com", cc: [], bcc: [] },
      ] as never);

      await manualEmailService.recentRecipients("org_1", "user_1");
      vi.advanceTimersByTime(61_000);
      await manualEmailService.recentRecipients("org_1", "user_1");

      expect(prismaMock.emailJob.findMany).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("manualEmailService.preview", () => {
  it("returns authored HTML and summarizes recipients", async () => {
    prismaMock.contact.findMany.mockResolvedValue([] as never);
    const result = await manualEmailService.preview({
      organizationId: "org_1",
      subject: "Subject",
      html: "<p>Hi</p>",
      to: ["a@x.com", "a@x.com"],
    });

    expect(result.subject).toBe("Subject");
    expect(result.recipients.to).toEqual(["a@x.com"]);
    expect(result.recipients.total).toBe(1);
    expect(result.html).toBe("<p>Hi</p>");
  });

  it("returns an empty body when there is nothing to render", async () => {
    const result = await manualEmailService.preview({
      organizationId: "org_1",
    });
    expect(result.html).toBe("");
    expect(result.recipients.total).toBe(0);
  });
});


it("does not apply saved organization branding to composer sends", async () => {
  prismaMock.organization.findUnique.mockResolvedValue({ brandName: "Existing brand", layoutHtml: "<html><body>{{content}}</body></html>", brandingEnabled: true } as never);
  await manualEmailService.send({ organizationId: "org_1", to: ["a@x.com"], subject: "Hi", html: "<p>Body</p>" }, "user_1");
  expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  expect(send.mock.calls[0][0].html).toBe("<p>Body</p>");
});
