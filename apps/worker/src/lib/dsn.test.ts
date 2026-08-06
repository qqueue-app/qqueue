import { simpleParser } from "mailparser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";

const h = vi.hoisted(() => ({
  enqueueLatestWebhookDeliveries: vi.fn(),
}));

vi.mock("./outbound-webhooks.js", () => ({
  enqueueLatestWebhookDeliveries: h.enqueueLatestWebhookDeliveries,
}));

import { applyDsnBounce, parseDsn, type ParsedDsn } from "./dsn.js";

/** A structured multipart/report DSN the way real MTAs send them. */
function rawDsn(input: {
  action: string;
  status: string;
  diagnostic: string;
  recipient?: string;
  originalMessageId?: string;
}) {
  const recipient = input.recipient ?? "bob@example.com";
  return [
    "Return-Path: <>",
    "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
    "To: sender@acme.test",
    "Subject: Delivery Status Notification",
    "Message-ID: <dsn-1@googlemail.com>",
    "Auto-Submitted: auto-replied",
    'Content-Type: multipart/report; report-type=delivery-status; boundary="BOUND"',
    "Date: Wed, 05 Aug 2026 10:00:00 +0000",
    "",
    "--BOUND",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    `Delivery to ${recipient} did not complete.`,
    "",
    "--BOUND",
    "Content-Type: message/delivery-status",
    "",
    "Reporting-MTA: dns; googlemail.com",
    "",
    `Final-Recipient: rfc822; ${recipient}`,
    `Action: ${input.action}`,
    `Status: ${input.status}`,
    "Remote-MTA: dns; mx.example.com",
    `Diagnostic-Code: smtp; ${input.diagnostic}`,
    " (folded continuation)",
    "",
    "--BOUND",
    "Content-Type: message/rfc822",
    "",
    "From: sender@acme.test",
    `To: ${recipient}`,
    "Subject: Hello",
    `Message-ID: ${input.originalMessageId ?? "<orig-123@acme.test>"}`,
    "",
    "original body",
    "--BOUND--",
    "",
  ].join("\r\n");
}

beforeEach(() => {
  h.enqueueLatestWebhookDeliveries.mockReset();
});

describe("parseDsn", () => {
  it("parses a Gmail-style 550 5.1.1 user-unknown report", async () => {
    const mail = await simpleParser(
      rawDsn({
        action: "failed",
        status: "5.1.1",
        diagnostic:
          "550-5.1.1 The email account that you tried to reach does not exist.",
      })
    );

    const dsn = parseDsn(mail);

    expect(dsn).not.toBeNull();
    expect(dsn?.parsedVia).toBe("delivery-status");
    expect(dsn?.originalMessageId).toBe("<orig-123@acme.test>");
    expect(dsn?.recipients).toEqual([
      {
        recipient: "bob@example.com",
        action: "failed",
        status: "5.1.1",
        // The folded continuation line is unfolded into the code.
        diagnosticCode:
          "smtp; 550-5.1.1 The email account that you tried to reach does not exist. (folded continuation)",
      },
    ]);
  });

  it("parses a 4.2.2 mailbox-full soft bounce", async () => {
    const mail = await simpleParser(
      rawDsn({
        action: "failed",
        status: "4.2.2",
        diagnostic: "452 4.2.2 Mailbox full",
      })
    );

    const dsn = parseDsn(mail);

    expect(dsn?.recipients[0]).toMatchObject({
      recipient: "bob@example.com",
      action: "failed",
      status: "4.2.2",
    });
  });

  it("keeps a delayed notification's action so processing can ignore it", async () => {
    const mail = await simpleParser(
      rawDsn({
        action: "delayed",
        status: "4.4.1",
        diagnostic: "421 4.4.1 Connection timed out; message still queued",
      })
    );

    expect(parseDsn(mail)?.recipients[0]?.action).toBe("delayed");
  });

  it("falls back to a body scan for a daemon bounce without delivery-status fields", async () => {
    const mail = await simpleParser(
      [
        "From: Mail Delivery System <mailer-daemon@mx.acme.test>",
        "To: sender@acme.test",
        "Subject: Undelivered Mail Returned to Sender",
        "Content-Type: text/plain",
        "",
        "The following message to <carol@example.org> was undeliverable.",
        "The reason for the problem:",
        "550 5.1.1 unknown user",
        "",
      ].join("\r\n")
    );

    const dsn = parseDsn(mail, { excludeAddresses: ["sender@acme.test"] });

    expect(dsn?.parsedVia).toBe("body-scan");
    expect(dsn?.recipients).toEqual([
      {
        recipient: "carol@example.org",
        action: "failed",
        status: "5.1.1",
        diagnosticCode: "550 5.1.1 unknown user",
      },
    ]);
  });

  it("does not body-scan a delay notice into a failure", async () => {
    const mail = await simpleParser(
      [
        "From: mailer-daemon@mx.acme.test",
        "To: sender@acme.test",
        "Subject: Delivery Status Notification (Delay)",
        "Content-Type: text/plain",
        "",
        "Message to bob@example.com not yet delivered (450 4.4.1).",
        "Will keep trying until the message is 3 days old.",
        "",
      ].join("\r\n")
    );

    expect(parseDsn(mail)).toBeNull();
  });

  it("ignores ordinary mail", async () => {
    const mail = await simpleParser(
      [
        "From: Human <human@example.com>",
        "To: sender@acme.test",
        "Subject: Re: Hello",
        "",
        "Sounds good. Call me at 550 5551234.",
        "",
      ].join("\r\n")
    );

    expect(parseDsn(mail)).toBeNull();
  });

  it("ignores auto-replied mail without delivery-status fields (vacation responders)", async () => {
    const mail = await simpleParser(
      [
        "From: Human <human@example.com>",
        "To: sender@acme.test",
        "Subject: Out of office",
        "Auto-Submitted: auto-replied",
        "",
        "I am away until 2026-09-01.",
        "",
      ].join("\r\n")
    );

    expect(parseDsn(mail)).toBeNull();
  });
});

describe("applyDsnBounce", () => {
  const jobRow = { id: "job-1", status: "SENT", campaignRunId: null };

  function dsn(overrides: Partial<ParsedDsn> = {}): ParsedDsn {
    return {
      recipients: [
        {
          recipient: "bob@example.com",
          action: "failed",
          status: "5.1.1",
          diagnosticCode: "smtp; 550 5.1.1 user unknown",
        },
      ],
      originalMessageId: "<orig-123@acme.test>",
      parsedVia: "delivery-status",
      ...overrides,
    };
  }

  it("records the bounce on the thread-correlated job, fails it, and suppresses", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(jobRow as never);

    await applyDsnBounce({
      organizationId: "org-1",
      inboundMessageId: "in-1",
      threadEmailJobId: "job-1",
      dsn: dsn(),
    });

    expect(prismaMock.emailJob.findUnique).toHaveBeenCalledWith({
      where: { id: "job-1" },
      select: { id: true, status: true, campaignRunId: true },
    });

    expect(prismaMock.emailEvent.create).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        emailJobId: "job-1",
        type: "BOUNCED",
        metadata: {
          source: "dsn",
          inboundMessageId: "in-1",
          correlation: "in-reply-to",
          finalRecipient: "bob@example.com",
          bounceType: "HARD",
          status: "5.1.1",
          reason: "smtp; 550 5.1.1 user unknown",
        },
      },
    });

    // SENT -> FAILED as a compare-and-set: the status filter is the guard.
    expect(prismaMock.emailJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "SENT" },
      data: { status: "FAILED" },
    });

    expect(h.enqueueLatestWebhookDeliveries).toHaveBeenCalledWith({
      organizationId: "org-1",
      emailJobId: "job-1",
      type: "BOUNCED",
    });

    expect(prismaMock.contact.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        email: { equals: "bob@example.com", mode: "insensitive" },
      },
      data: { status: "BOUNCED" },
    });
    expect(prismaMock.suppression.upsert).toHaveBeenCalledWith({
      where: {
        organizationId_email: {
          organizationId: "org-1",
          email: "bob@example.com",
        },
      },
      create: {
        organizationId: "org-1",
        email: "bob@example.com",
        reason: "BOUNCE",
        source: "dsn:in-1",
      },
      update: { reason: "BOUNCE", source: "dsn:in-1" },
    });
  });

  it("falls back to the returned original's Message-ID when no thread matched", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue(jobRow as never);

    await applyDsnBounce({
      organizationId: "org-1",
      inboundMessageId: "in-1",
      threadEmailJobId: null,
      dsn: dsn(),
    });

    expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", messageId: "<orig-123@acme.test>" },
      select: { id: true, status: true, campaignRunId: true },
    });
    const created = prismaMock.emailEvent.create.mock.calls[0][0];
    expect(created.data.metadata).toMatchObject({
      correlation: "original-message-id",
    });
  });

  it("falls back to the most recent SENT job to the failed address", async () => {
    prismaMock.emailJob.findFirst
      .mockResolvedValueOnce(null) // by original Message-ID
      .mockResolvedValueOnce(jobRow as never); // by recipient recency

    await applyDsnBounce({
      organizationId: "org-1",
      inboundMessageId: "in-1",
      threadEmailJobId: null,
      dsn: dsn(),
    });

    const recency = prismaMock.emailJob.findFirst.mock.calls[1][0];
    expect(recency).toMatchObject({
      where: {
        organizationId: "org-1",
        toEmail: "bob@example.com",
        status: "SENT",
        sentAt: { gte: expect.any(Date) },
      },
      orderBy: { sentAt: "desc" },
    });
    const created = prismaMock.emailEvent.create.mock.calls[0][0];
    expect(created.data.metadata).toMatchObject({
      correlation: "recipient-recency",
    });
  });

  it("still suppresses a hard bounce when no job could be correlated", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue(null);

    await applyDsnBounce({
      organizationId: "org-1",
      inboundMessageId: "in-1",
      threadEmailJobId: null,
      dsn: dsn(),
    });

    expect(prismaMock.emailEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.emailJob.updateMany).not.toHaveBeenCalled();
    expect(h.enqueueLatestWebhookDeliveries).not.toHaveBeenCalled();
    expect(prismaMock.suppression.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          email: "bob@example.com",
          reason: "BOUNCE",
        }),
      })
    );
  });

  it("counts a soft bounce toward the threshold without suppressing below it", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(jobRow as never);
    prismaMock.suppressionPolicy.findUnique.mockResolvedValue(null);
    prismaMock.emailEvent.count.mockResolvedValue(1); // env default threshold is 3

    await applyDsnBounce({
      organizationId: "org-1",
      inboundMessageId: "in-1",
      threadEmailJobId: "job-1",
      dsn: dsn({
        recipients: [
          {
            recipient: "bob@example.com",
            action: "failed",
            status: "4.2.2",
            diagnosticCode: "452 4.2.2 Mailbox full",
          },
        ],
      }),
    });

    const created = prismaMock.emailEvent.create.mock.calls[0][0];
    expect(created.data.metadata).toMatchObject({ bounceType: "SOFT" });
    expect(prismaMock.emailJob.updateMany).toHaveBeenCalled();
    expect(prismaMock.suppression.upsert).not.toHaveBeenCalled();
  });

  it("suppresses a soft bounce once the org threshold is reached", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(jobRow as never);
    prismaMock.suppressionPolicy.findUnique.mockResolvedValue(null);
    prismaMock.emailEvent.count.mockResolvedValue(3);

    await applyDsnBounce({
      organizationId: "org-1",
      inboundMessageId: "in-1",
      threadEmailJobId: "job-1",
      dsn: dsn({
        recipients: [
          {
            recipient: "bob@example.com",
            action: "failed",
            status: "4.2.2",
            diagnosticCode: "452 4.2.2 Mailbox full",
          },
        ],
      }),
    });

    expect(prismaMock.suppression.upsert).toHaveBeenCalled();
  });

  it("ignores a delayed action: it is not an outcome yet", async () => {
    await applyDsnBounce({
      organizationId: "org-1",
      inboundMessageId: "in-1",
      threadEmailJobId: "job-1",
      dsn: dsn({
        recipients: [
          {
            recipient: "bob@example.com",
            action: "delayed",
            status: "4.4.1",
          },
        ],
      }),
    });

    expect(prismaMock.emailJob.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.emailEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.suppression.upsert).not.toHaveBeenCalled();
  });

  // A DSN is the only delivery confirmation a self-hosted install gets without
  // an ESP webhook. These reports were parsed and discarded, which left the
  // dashboard with no honest delivery number and the open pixel filling in.
  it.each(["delivered", "relayed"])(
    "records a DELIVERED event for a %s report",
    async (action) => {
      prismaMock.emailJob.findUnique.mockResolvedValue(jobRow as never);

      await applyDsnBounce({
        organizationId: "org-1",
        inboundMessageId: "in-1",
        threadEmailJobId: "job-1",
        dsn: dsn({
          recipients: [
            { recipient: "bob@example.com", action, status: "2.0.0" },
          ],
        }),
      });

      expect(prismaMock.emailEvent.create).toHaveBeenCalledWith({
        data: {
          organizationId: "org-1",
          emailJobId: "job-1",
          type: "DELIVERED",
          metadata: {
            // The source tag is what separates an observed delivery from the
            // open-derived rows the reporting must not count.
            source: "dsn",
            inboundMessageId: "in-1",
            correlation: "in-reply-to",
            finalRecipient: "bob@example.com",
            action,
            status: "2.0.0",
          },
        },
      });

      expect(h.enqueueLatestWebhookDeliveries).toHaveBeenCalledWith({
        organizationId: "org-1",
        emailJobId: "job-1",
        type: "DELIVERED",
      });

      // A delivery is not a bounce: nothing flips status, nothing suppresses.
      expect(prismaMock.emailJob.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.suppression.upsert).not.toHaveBeenCalled();
    },
  );

  it("drops an uncorrelated delivery report", async () => {
    // Unlike a bounce, a delivery carries no consequence for the address on its
    // own, so there is nothing to record when no job matches.
    prismaMock.emailJob.findUnique.mockResolvedValue(null);
    prismaMock.emailJob.findFirst.mockResolvedValue(null);

    await applyDsnBounce({
      organizationId: "org-1",
      inboundMessageId: "in-1",
      threadEmailJobId: null,
      dsn: dsn({
        recipients: [
          { recipient: "ghost@example.com", action: "delivered", status: "2.0.0" },
        ],
        originalMessageId: null,
      }),
    });

    expect(prismaMock.emailEvent.create).not.toHaveBeenCalled();
  });
});
